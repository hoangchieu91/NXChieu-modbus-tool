use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Local;
use tokio_modbus::client::{Context, Reader, Writer};
use tokio_modbus::prelude::*;
use tokio_serial::SerialPortBuilderExt;

use crate::models::{ConnectionConfig, PollDefinition, PollResult, WriteCoilParam, WriteRegisterParam};
use super::crc::*;

pub enum ModbusBackend {
    Live(Context),
    Simulated {
        registers: HashMap<u16, u16>,
        coils: HashMap<u16, bool>,
        tick: u64,
    },
}

pub struct ModbusManager {
    pub backend: Option<ModbusBackend>,
    pub active_config: Option<ConnectionConfig>,
    pub current_def: Option<PollDefinition>,
    pub is_polling: Arc<AtomicBool>,
    pub tx_count: Arc<AtomicU64>,
    pub err_count: Arc<AtomicU64>,
}

impl ModbusManager {
    pub fn new() -> Self {
        Self {
            backend: None,
            active_config: None,
            current_def: None,
            is_polling: Arc::new(AtomicBool::new(false)),
            tx_count: Arc::new(AtomicU64::new(0)),
            err_count: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.backend.is_some()
    }

    pub fn is_polling(&self) -> bool {
        self.is_polling.load(Ordering::Relaxed)
    }

    pub async fn connect(&mut self, config: ConnectionConfig) -> Result<String, String> {
        self.disconnect().await;

        match config.clone() {
            ConnectionConfig::Serial {
                port,
                baud_rate,
                data_bits,
                parity,
                stop_bits,
                timeout_ms,
            } => {
                if port.to_lowercase() == "simulator" || port.to_lowercase() == "sim" {
                    let mut registers = HashMap::new();
                    // Simulated realistic meter registers
                    registers.insert(0, 2205); // 220.5 V
                    registers.insert(1, 512);  // 5.12 A
                    registers.insert(2, 1128); // 1128 W
                    registers.insert(3, 98);   // PF 0.98
                    registers.insert(4, 5001); // 50.01 Hz
                    registers.insert(5, 100);
                    registers.insert(6, 200);

                    let mut coils = HashMap::new();
                    coils.insert(0, true);
                    coils.insert(1, false);
                    coils.insert(2, true);

                    self.backend = Some(ModbusBackend::Simulated {
                        registers,
                        coils,
                        tick: 0,
                    });
                    self.active_config = Some(config);
                    self.tx_count.store(0, Ordering::Relaxed);
                    self.err_count.store(0, Ordering::Relaxed);
                    return Ok("Connected to Virtual Simulator".to_string());
                }

                let p_data_bits = match data_bits {
                    7 => tokio_serial::DataBits::Seven,
                    _ => tokio_serial::DataBits::Eight,
                };
                let p_parity = match parity.to_lowercase().as_str() {
                    "even" => tokio_serial::Parity::Even,
                    "odd" => tokio_serial::Parity::Odd,
                    _ => tokio_serial::Parity::None,
                };
                let p_stop_bits = match stop_bits {
                    2 => tokio_serial::StopBits::Two,
                    _ => tokio_serial::StopBits::One,
                };

                let serial_builder = tokio_serial::new(&port, baud_rate)
                    .data_bits(p_data_bits)
                    .parity(p_parity)
                    .stop_bits(p_stop_bits)
                    .timeout(Duration::from_millis(timeout_ms));

                let serial_stream = serial_builder
                    .open_native_async()
                    .map_err(|e| format!("Failed to open serial port {}: {}", port, e))?;

                let ctx = tokio_modbus::client::rtu::attach_slave(serial_stream, Slave(1));

                self.backend = Some(ModbusBackend::Live(ctx));
                self.active_config = Some(config);
                self.tx_count.store(0, Ordering::Relaxed);
                self.err_count.store(0, Ordering::Relaxed);
                Ok(format!("Connected to Serial Port {}", port))
            }
            ConnectionConfig::Tcp {
                host,
                port,
                timeout_ms: _,
            } => {
                if host == "simulator" || host == "sim" {
                    let mut registers = HashMap::new();
                    registers.insert(0, 2205);
                    registers.insert(1, 512);
                    registers.insert(2, 1128);
                    registers.insert(3, 98);
                    registers.insert(4, 5001);

                    let mut coils = HashMap::new();
                    coils.insert(0, true);
                    coils.insert(1, false);

                    self.backend = Some(ModbusBackend::Simulated {
                        registers,
                        coils,
                        tick: 0,
                    });
                    self.active_config = Some(config);
                    self.tx_count.store(0, Ordering::Relaxed);
                    self.err_count.store(0, Ordering::Relaxed);
                    return Ok("Connected to Virtual Simulator".to_string());
                }

                let addr_str = format!("{}:{}", host, port);
                let socket_addr: SocketAddr = addr_str
                    .parse()
                    .map_err(|e| format!("Invalid TCP address '{}': {}", addr_str, e))?;

                let ctx = tokio_modbus::client::tcp::connect_slave(socket_addr, Slave(1))
                    .await
                    .map_err(|e| format!("Failed to connect to Modbus TCP {}: {}", addr_str, e))?;

                self.backend = Some(ModbusBackend::Live(ctx));
                self.active_config = Some(config);
                self.tx_count.store(0, Ordering::Relaxed);
                self.err_count.store(0, Ordering::Relaxed);
                Ok(format!("Connected to Modbus TCP {}", addr_str))
            }
        }
    }

    pub async fn disconnect(&mut self) {
        self.is_polling.store(false, Ordering::Relaxed);
        self.backend = None;
        self.active_config = None;
    }

    pub async fn execute_read(&mut self, def: &PollDefinition) -> PollResult {
        let start = Instant::now();
        let timestamp = Local::now().format("%H:%M:%S%.3f").to_string();
        self.tx_count.fetch_add(1, Ordering::Relaxed);
        let tx = self.tx_count.load(Ordering::Relaxed);
        let err = self.err_count.load(Ordering::Relaxed);

        let raw_tx = format_hex(&build_rtu_read_request(
            def.slave_id,
            def.function_code,
            def.start_address,
            def.quantity,
        ));

        let is_coil = def.function_code == 1 || def.function_code == 2;

        match &mut self.backend {
            Some(ModbusBackend::Live(ctx)) => {
                ctx.set_slave(Slave(def.slave_id));
                let read_res: Result<(Vec<u16>, Vec<bool>), String> = match def.function_code {
                    1 => match ctx.read_coils(def.start_address, def.quantity).await {
                        Ok(Ok(coils)) => Ok((vec![], coils)),
                        Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                        Err(e) => Err(format!("Transport Error: {}", e)),
                    },
                    2 => match ctx.read_discrete_inputs(def.start_address, def.quantity).await {
                        Ok(Ok(coils)) => Ok((vec![], coils)),
                        Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                        Err(e) => Err(format!("Transport Error: {}", e)),
                    },
                    3 => match ctx.read_holding_registers(def.start_address, def.quantity).await {
                        Ok(Ok(regs)) => Ok((regs, vec![])),
                        Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                        Err(e) => Err(format!("Transport Error: {}", e)),
                    },
                    4 => match ctx.read_input_registers(def.start_address, def.quantity).await {
                        Ok(Ok(regs)) => Ok((regs, vec![])),
                        Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                        Err(e) => Err(format!("Transport Error: {}", e)),
                    },
                    _ => Err(format!("Unsupported function code: {}", def.function_code)),
                };

                let latency_ms = start.elapsed().as_millis() as u64;

                match read_res {
                    Ok((regs, coils)) => {
                        let raw_rx = if is_coil {
                            format_hex(&build_rtu_coil_response(
                                def.slave_id,
                                def.function_code,
                                &coils,
                            ))
                        } else {
                            format_hex(&build_rtu_register_response(
                                def.slave_id,
                                def.function_code,
                                &regs,
                            ))
                        };

                        PollResult {
                            timestamp,
                            values: regs,
                            bool_values: coils,
                            is_coil,
                            tx_count: tx,
                            err_count: err,
                            latency_ms,
                            error: None,
                            raw_tx: Some(raw_tx),
                            raw_rx: Some(raw_rx),
                        }
                    }
                    Err(e) => {
                        self.err_count.fetch_add(1, Ordering::Relaxed);
                        PollResult {
                            timestamp,
                            values: vec![],
                            bool_values: vec![],
                            is_coil,
                            tx_count: tx,
                            err_count: self.err_count.load(Ordering::Relaxed),
                            latency_ms,
                            error: Some(e),
                            raw_tx: Some(raw_tx),
                            raw_rx: None,
                        }
                    }
                }
            }
            Some(ModbusBackend::Simulated {
                registers,
                coils,
                tick,
            }) => {
                *tick += 1;
                let noise = ((*tick % 7) as i16 - 3);
                let v = (2205 + noise).max(0) as u16;
                registers.insert(0, v);
                registers.insert(1, (510 + (*tick % 6)) as u16);
                registers.insert(2, (1120 + noise * 5).max(0) as u16);
                registers.insert(4, (5000 + (*tick % 4)) as u16);
                registers.insert(5, (45 + (*tick % 3)) as u16);
                registers.insert(7, (*tick % 65535) as u16);

                let latency_ms = 8;

                if is_coil {
                    let mut bits = Vec::with_capacity(def.quantity as usize);
                    for i in 0..def.quantity {
                        let addr = def.start_address + i;
                        bits.push(*coils.get(&addr).unwrap_or(&false));
                    }
                    let raw_rx = format_hex(&build_rtu_coil_response(
                        def.slave_id,
                        def.function_code,
                        &bits,
                    ));
                    PollResult {
                        timestamp,
                        values: vec![],
                        bool_values: bits,
                        is_coil: true,
                        tx_count: tx,
                        err_count: err,
                        latency_ms,
                        error: None,
                        raw_tx: Some(raw_tx),
                        raw_rx: Some(raw_rx),
                    }
                } else {
                    let mut vals = Vec::with_capacity(def.quantity as usize);
                    for i in 0..def.quantity {
                        let addr = def.start_address + i;
                        vals.push(*registers.get(&addr).unwrap_or(&(addr * 10)));
                    }
                    let raw_rx = format_hex(&build_rtu_register_response(
                        def.slave_id,
                        def.function_code,
                        &vals,
                    ));
                    PollResult {
                        timestamp,
                        values: vals,
                        bool_values: vec![],
                        is_coil: false,
                        tx_count: tx,
                        err_count: err,
                        latency_ms,
                        error: None,
                        raw_tx: Some(raw_tx),
                        raw_rx: Some(raw_rx),
                    }
                }
            }
            None => PollResult {
                timestamp,
                values: vec![],
                bool_values: vec![],
                is_coil,
                tx_count: tx,
                err_count: err,
                latency_ms: 0,
                error: Some("Not connected".to_string()),
                raw_tx: None,
                raw_rx: None,
            },
        }
    }

    pub async fn write_register(&mut self, param: WriteRegisterParam) -> Result<(), String> {
        match &mut self.backend {
            Some(ModbusBackend::Live(ctx)) => {
                ctx.set_slave(Slave(param.slave_id));
                match ctx.write_single_register(param.address, param.value).await {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                    Err(e) => Err(format!("Transport Error: {}", e)),
                }
            }
            Some(ModbusBackend::Simulated { registers, .. }) => {
                registers.insert(param.address, param.value);
                Ok(())
            }
            None => Err("Not connected to device".to_string()),
        }
    }

    pub async fn write_coil(&mut self, param: WriteCoilParam) -> Result<(), String> {
        match &mut self.backend {
            Some(ModbusBackend::Live(ctx)) => {
                ctx.set_slave(Slave(param.slave_id));
                match ctx.write_single_coil(param.address, param.value).await {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(ex)) => Err(format!("Modbus Exception: {:?}", ex)),
                    Err(e) => Err(format!("Transport Error: {}", e)),
                }
            }
            Some(ModbusBackend::Simulated { coils, .. }) => {
                coils.insert(param.address, param.value);
                Ok(())
            }
            None => Err("Not connected to device".to_string()),
        }
    }
}
