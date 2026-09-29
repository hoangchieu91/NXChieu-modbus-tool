use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortDetail {
    pub port_name: String,
    pub description: Option<String>,
    pub hardware_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Serial {
        port: String,
        baud_rate: u32,
        data_bits: u8,
        parity: String, // "none", "even", "odd"
        stop_bits: u8,  // 1, 2
        timeout_ms: u64,
    },
    Tcp {
        host: String,
        port: u16,
        timeout_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollDefinition {
    pub slave_id: u8,
    pub function_code: u8, // 1: Coils, 2: Discrete, 3: Holding, 4: Input
    pub start_address: u16,
    pub quantity: u16,
    pub scan_rate_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollResult {
    pub timestamp: String,
    pub values: Vec<u16>,
    pub bool_values: Vec<bool>,
    pub is_coil: bool,
    pub tx_count: u64,
    pub err_count: u64,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub raw_tx: Option<String>,
    pub raw_rx: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRegisterParam {
    pub slave_id: u8,
    pub address: u16,
    pub value: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteCoilParam {
    pub slave_id: u8,
    pub address: u16,
    pub value: bool,
}
