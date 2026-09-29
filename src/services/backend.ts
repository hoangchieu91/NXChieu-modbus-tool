import * as AppMethods from '../../wailsjs/go/main/App';
import * as WailsRuntime from '../../wailsjs/runtime/runtime';
import {
  ConnectionConfig,
  PollDefinition,
  PollResult,
  SerialPortDetail,
  SimulationConfig,
  SlaveActivityEvent,
  SlaveConfig,
  SlaveMemorySlice,
  WriteCoilParam,
  WriteRegisterParam,
  WriteRegistersParam,
} from '../types/modbus';

export const isWailsApp = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as unknown as { go?: unknown }).go);
};

export async function listSerialPorts(): Promise<SerialPortDetail[]> {
  try {
    const ports = await AppMethods.ListSerialPorts();
    return ports.map((p) => ({
      port_name: p.port_name,
      description: p.description,
      hardware_id: p.hardware_id,
    }));
  } catch (err) {
    console.warn('listSerialPorts error:', err);
    return [
      { port_name: 'COM1', description: 'Standard Serial Port' },
      { port_name: 'COM2', description: 'Virtual COM Port (COM2)' },
      { port_name: 'COM49', description: 'USB-SERIAL CH340 (COM49)' },
    ];
  }
}

// --- Session-Aware Master Operations ---

export async function sessionConnect(sessionId: string, config: ConnectionConfig): Promise<string> {
  const goConfig: Record<string, unknown> = {
    type: config.type,
    timeout_ms: config.timeout_ms,
  };
  if (config.type === 'serial') {
    goConfig.port = config.port;
    goConfig.baud_rate = config.baud_rate;
    goConfig.data_bits = config.data_bits;
    goConfig.parity = config.parity;
    goConfig.stop_bits = config.stop_bits;
  } else {
    goConfig.host = config.host;
    goConfig.port_tcp = config.port;
  }
  return await AppMethods.SessionConnect(sessionId, goConfig as any);
}

export async function closeSession(sessionId: string): Promise<void> {
  await AppMethods.CloseSession(sessionId);
}

export async function sessionDisconnect(sessionId: string): Promise<void> {
  await AppMethods.SessionDisconnect(sessionId);
}

export async function sessionStartPolling(sessionId: string, def: PollDefinition): Promise<void> {
  await AppMethods.SessionStartPolling(sessionId, def as any);
}

export async function sessionStopPolling(sessionId: string): Promise<void> {
  await AppMethods.SessionStopPolling(sessionId);
}

export async function sessionReadOnce(sessionId: string, def: PollDefinition): Promise<PollResult> {
  const res = await AppMethods.SessionReadOnce(sessionId, def as any);
  return {
    session_id: res.session_id,
    timestamp: res.timestamp,
    values: res.values || [],
    bool_values: res.bool_values || [],
    is_coil: res.is_coil,
    tx_count: res.tx_count,
    err_count: res.err_count,
    latency_ms: res.latency_ms,
    error: res.error,
    raw_tx: res.raw_tx,
    raw_rx: res.raw_rx,
  };
}

export async function sessionWriteRegister(sessionId: string, param: WriteRegisterParam): Promise<void> {
  await AppMethods.SessionWriteRegister(sessionId, param as any);
}

export async function sessionWriteRegisters(sessionId: string, param: WriteRegistersParam): Promise<void> {
  await AppMethods.SessionWriteRegisters(sessionId, param as any);
}

export async function sessionWriteCoil(sessionId: string, param: WriteCoilParam): Promise<void> {
  await AppMethods.SessionWriteCoil(sessionId, param as any);
}

// Backward compatibility default master operations
export async function connectBackend(config: ConnectionConfig): Promise<string> {
  return sessionConnect('default', config);
}

export async function disconnectBackend(): Promise<void> {
  return sessionDisconnect('default');
}

export async function startPollingBackend(def: PollDefinition): Promise<void> {
  return sessionStartPolling('default', def);
}

export async function stopPollingBackend(): Promise<void> {
  return sessionStopPolling('default');
}

export async function readOnceBackend(def: PollDefinition): Promise<PollResult> {
  return sessionReadOnce('default', def);
}

export async function writeRegisterBackend(param: WriteRegisterParam): Promise<void> {
  return sessionWriteRegister('default', param);
}

export async function writeRegistersBackend(param: WriteRegistersParam): Promise<void> {
  return sessionWriteRegisters('default', param);
}

export async function writeCoilBackend(param: WriteCoilParam): Promise<void> {
  return sessionWriteCoil('default', param);
}

// --- Modbus Slave (Server Simulator) Operations ---

export async function slaveStart(sessionId: string, config: SlaveConfig): Promise<void> {
  const goConfig: Record<string, unknown> = {
    type: config.type,
    slave_id: config.slave_id,
  };
  if (config.type === 'serial') {
    goConfig.port = config.port;
    goConfig.baud_rate = config.baud_rate;
    goConfig.data_bits = config.data_bits;
    goConfig.parity = config.parity;
    goConfig.stop_bits = config.stop_bits;
  } else {
    goConfig.host = config.host;
    goConfig.port_tcp = config.port_tcp;
  }
  await AppMethods.SlaveStart(sessionId, goConfig as any);
}

export async function slaveStop(sessionId: string): Promise<void> {
  await AppMethods.SlaveStop(sessionId);
}

export async function slaveIsListening(sessionId: string): Promise<boolean> {
  return await AppMethods.SlaveIsListening(sessionId);
}

export async function slaveGetSlice(
  sessionId: string,
  table: string,
  startAddr: number,
  qty: number
): Promise<SlaveMemorySlice> {
  const res = await AppMethods.SlaveGetSlice(sessionId, table, startAddr, qty);
  return {
    session_id: res.session_id,
    table: res.table,
    start_address: res.start_address,
    quantity: res.quantity,
    values: res.values || [],
    bool_values: res.bool_values || [],
  };
}

export async function slaveSetRegister(sessionId: string, table: string, addr: number, val: number): Promise<void> {
  await AppMethods.SlaveSetRegister(sessionId, table, addr, val);
}

export async function slaveSetCoil(sessionId: string, table: string, addr: number, val: boolean): Promise<void> {
  await AppMethods.SlaveSetCoil(sessionId, table, addr, val);
}

export async function slaveStartSim(sessionId: string, config: SimulationConfig): Promise<void> {
  await AppMethods.SlaveStartSim(sessionId, config as any);
}

export async function slaveStopSim(sessionId: string): Promise<void> {
  await AppMethods.SlaveStopSim(sessionId);
}

// --- Wails Events Subscriptions ---

export function subscribePollData(callback: (data: PollResult) => void): () => void {
  try {
    const unbind = WailsRuntime.EventsOn('poll-data', (data: any) => {
      if (data) {
        callback({
          session_id: data.session_id,
          timestamp: data.timestamp,
          values: data.values || [],
          bool_values: data.bool_values || [],
          is_coil: data.is_coil,
          tx_count: data.tx_count,
          err_count: data.err_count,
          latency_ms: data.latency_ms,
          error: data.error,
          raw_tx: data.raw_tx,
          raw_rx: data.raw_rx,
        });
      }
    });
    return () => {
      unbind();
    };
  } catch (e) {
    console.error('Failed to subscribe to Wails poll-data:', e);
    return () => {};
  }
}

export function subscribeSlaveActivity(callback: (data: SlaveActivityEvent) => void): () => void {
  try {
    const unbind = WailsRuntime.EventsOn('slave-activity', (data: any) => {
      if (data) {
        callback({
          session_id: data.session_id,
          timestamp: data.timestamp,
          client: data.client,
          function: data.function,
          address: data.address,
          quantity: data.quantity,
          is_write: data.is_write,
          values: data.values || [],
          bools: data.bools || [],
          summary: data.summary,
          hex_raw: data.hex_raw,
        });
      }
    });
    return () => {
      unbind();
    };
  } catch (e) {
    console.error('Failed to subscribe to Wails slave-activity:', e);
    return () => {};
  }
}

// --- Diagnostic & Scanner API Wrappers ---

export async function scanSlaveIDs(
  sessionId: string,
  startId: number,
  endId: number,
  timeoutMs: number = 100
): Promise<import('../types/modbus').SlaveScanItem[]> {
  try {
    const results = await AppMethods.ScanSlaveIDs(sessionId, startId, endId, timeoutMs);
    return (results || []).map((r) => ({
      slave_id: r.slave_id,
      status: r.status,
      detail: r.detail,
      latency_ms: r.latency_ms,
      raw_rx: r.raw_rx,
    }));
  } catch (e: any) {
    console.error('scanSlaveIDs error:', e);
    return [];
  }
}

export async function autoDetectBaudrate(
  port: string,
  slaveId: number,
  bauds: number[] = [9600, 19200, 115200, 38400, 4800, 2400, 57600],
  parities: string[] = ['none', 'even', 'odd']
): Promise<import('../types/modbus').BaudScanItem[]> {
  try {
    const results = await AppMethods.AutoDetectBaudrate(port, slaveId, bauds, parities);
    return (results || []).map((r) => ({
      baud_rate: r.baud_rate,
      parity: r.parity,
      stop_bits: r.stop_bits,
      success: r.success,
      latency_ms: r.latency_ms,
      detail: r.detail,
    }));
  } catch (e: any) {
    console.error('autoDetectBaudrate error:', e);
    return [];
  }
}

export async function scanRegisters(
  sessionId: string,
  fc: number,
  startAddr: number,
  endAddr: number
): Promise<import('../types/modbus').RegisterScanItem[]> {
  try {
    const results = await AppMethods.ScanRegisters(sessionId, fc, startAddr, endAddr);
    return (results || []).map((r) => ({
      address: r.address,
      valid: r.valid,
      value: r.value,
      hex: r.hex,
      detail: r.detail,
    }));
  } catch (e: any) {
    console.error('scanRegisters error:', e);
    return [];
  }
}

// --- Web Remote Server Operations ---

export async function startRemoteServer(
  port: number = 8088,
  allowWrite: boolean = false
): Promise<import('../types/modbus').RemoteServerStatus> {
  // Errors (e.g. port already in use) propagate so the UI can show them.
  return (AppMethods as any).StartRemoteServer(port, allowWrite);
}

export async function stopRemoteServer(): Promise<import('../types/modbus').RemoteServerStatus> {
  try {
    const res = await (AppMethods as any).StopRemoteServer();
    return res;
  } catch (e: any) {
    console.error('stopRemoteServer error:', e);
    return {
      is_running: false,
      port: 8088,
      allow_write: false,
      active_clients: 0,
      token: '',
      interfaces: [],
    };
  }
}

export async function getRemoteServerStatus(): Promise<import('../types/modbus').RemoteServerStatus> {
  try {
    const res = await (AppMethods as any).GetRemoteServerStatus();
    return res;
  } catch (e: any) {
    console.error('getRemoteServerStatus error:', e);
    return {
      is_running: false,
      port: 8088,
      allow_write: false,
      active_clients: 0,
      token: '',
      interfaces: [],
    };
  }
}

export async function updateRemoteServerState(state: any): Promise<void> {
  try {
    await (AppMethods as any).UpdateRemoteServerState(state);
  } catch (e: any) {
    console.error('updateRemoteServerState error:', e);
  }
}

