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
  SnifferSnapshot,
  SnifferCaptureConfig,
  SnifferCaptureStatus,
  SnifferBaselineMode,
  SnifferBaselineProfile,
  WriteCoilParam,
  WriteRegisterParam,
  WriteRegistersParam,
} from '../types/modbus';

/** Frames of the built-in self-test sessions, kept out of the main analyzer. */
export async function getDiagnosticSnifferSnapshot(limit = 50): Promise<SnifferSnapshot> {
  return (AppMethods as any).GetDiagnosticSnifferSnapshot(limit);
}

export async function getSnifferSnapshot(limit = 1000): Promise<SnifferSnapshot> {
  try {
    return await (AppMethods as any).GetSnifferSnapshot(limit);
  } catch {
    return { generated_at: new Date().toISOString(), frames: [], health: { score: 0, state: 'unknown', total_frames: 0, requests: 0, responses: 0, exceptions: 0, timeouts: 0, retries: 0, malformed_frames: 0, crc_error_frames: 0, orphan_responses: 0, pending_requests: 0, average_latency_us: 0, p95_latency_us: 0, devices: [] } };
  }
}

export async function clearSniffer(): Promise<void> {
  await (AppMethods as any).ClearSniffer();
}

export async function setSnifferBaselineMode(mode: SnifferBaselineMode): Promise<SnifferBaselineProfile> {
  return await (AppMethods as any).SetSnifferBaselineMode(mode);
}

export async function getSnifferBaseline(): Promise<SnifferBaselineProfile> {
  return await (AppMethods as any).GetSnifferBaseline();
}

export async function resetSnifferBaseline(): Promise<SnifferBaselineProfile> {
  return await (AppMethods as any).ResetSnifferBaseline();
}

export async function startSniffer(config: SnifferCaptureConfig): Promise<SnifferCaptureStatus> {
  return await (AppMethods as any).StartSniffer(config);
}

export async function stopSniffer(): Promise<SnifferCaptureStatus> {
  return await (AppMethods as any).StopSniffer();
}

export async function getSnifferStatus(): Promise<SnifferCaptureStatus> {
  try {
    return await (AppMethods as any).GetSnifferStatus();
  } catch {
    return { running: false, mode: '', active_connections: 0, bytes_captured: 0, dropped_chunks: 0 };
  }
}

export async function saveSnifferCapture(): Promise<string> {
  return await (AppMethods as any).SaveSnifferCapture();
}

export async function openSnifferCapture(): Promise<string> {
  return await (AppMethods as any).OpenSnifferCapture();
}

export async function pickCaptureFile(title?: string): Promise<string> {
  return await (AppMethods as any).PickCaptureFile(title || '');
}

export async function exportSnifferCSV(): Promise<string> {
  return await (AppMethods as any).ExportSnifferCSV();
}

export async function loadSnifferProfileFile(): Promise<string> {
  return await (AppMethods as any).LoadSnifferProfileFile();
}

export async function setSnifferProfileCatalog(jsonContent: string): Promise<void> {
  return await (AppMethods as any).SetSnifferProfileCatalog(jsonContent);
}

export async function getSnifferProfileCatalog(): Promise<any> {
  return await (AppMethods as any).GetSnifferProfileCatalog();
}

export async function compareSnifferCaptures(pathA: string, pathB: string): Promise<import('../types/modbus').CaptureDiffResult> {
  return await (AppMethods as any).CompareSnifferCaptures(pathA, pathB);
}

export async function exportSnifferHTMLReport(opts: import('../types/modbus').ShiftReportOptions): Promise<string> {
  return await (AppMethods as any).ExportSnifferHTMLReport(opts);
}

export async function checkNpcapStatus(): Promise<import('../types/modbus').NpcapStatus> {
  return await (AppMethods as any).CheckNpcapStatus();
}

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

export async function sessionResetCounters(sessionId: string): Promise<void> {
  await (AppMethods as any).SessionResetCounters(sessionId);
}

export async function sessionStopPolling(sessionId: string): Promise<void> {
  await AppMethods.SessionStopPolling(sessionId);
}

// Go sends nil slices as null; the request fields (slave_id, function_code, start_address) are
// needed to map values to the right addresses and to drop stale results.
function toPollResult(res: any): PollResult {
  return {
    ...res,
    values: res.values || [],
    bool_values: res.bool_values || [],
  };
}

export async function sessionReadOnce(sessionId: string, def: PollDefinition): Promise<PollResult> {
  const res = await AppMethods.SessionReadOnce(sessionId, def as any);
  return toPollResult(res);
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

// --- Modbus Slave (Server Simulator) Operations ---

export async function slaveStart(sessionId: string, config: SlaveConfig): Promise<void> {
  const goConfig: Record<string, unknown> = {
    type: config.type,
    slave_id: config.slave_id,
    slave_id_end: config.slave_id_end || config.slave_id,
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
        callback(toPollResult(data));
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
  // Errors propagate so the scanner can record the ID as failed instead of silently skipping it.
  const results = await AppMethods.ScanSlaveIDs(sessionId, startId, endId, timeoutMs);
  return (results || []).map((r) => ({
    slave_id: r.slave_id,
    status: r.status,
    detail: r.detail,
    latency_ms: r.latency_ms,
    raw_rx: r.raw_rx,
  }));
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

export interface RemoteWriteEvent {
  id: string;
  tab_id: string;
  address: number;
  is_coil: boolean;
  bool_value: boolean;
  text: string;
}

/** A phone asked to write a value; the desktop performs it and must call completeRemoteWrite. */
export function subscribeRemoteWrite(callback: (req: RemoteWriteEvent) => void): () => void {
  try {
    const unbind = WailsRuntime.EventsOn('remote-write', (data: any) => {
      if (data && typeof data.id === 'string') callback(data as RemoteWriteEvent);
    });
    return () => unbind();
  } catch (e) {
    console.error('Failed to subscribe to Wails remote-write:', e);
    return () => {};
  }
}

export async function completeRemoteWrite(id: string, errorMessage: string): Promise<void> {
  try {
    await (AppMethods as any).CompleteRemoteWrite(id, errorMessage);
  } catch (e: any) {
    console.error('completeRemoteWrite error:', e);
  }
}

// Auto-discovery of baud, parity, slave id and readable registers
export async function autoDiscoverDevices(
  params: import('../types/modbus').AutoDiscoverParams
): Promise<import('../types/modbus').DiscoveredDevice[]> {
  try {
    const results = await (AppMethods as any).AutoDiscoverDevices(params);
    return results || [];
  } catch (e: any) {
    console.error('autoDiscoverDevices error:', e);
    return [];
  }
}

// Launch another independent instance/window of NXChieu Modbus Studio
export async function openNewInstance(): Promise<void> {
  try {
    await (AppMethods as any).OpenNewInstance();
  } catch (e: any) {
    console.error('openNewInstance error:', e);
  }
}

// Raw Serial / TTL Terminal backend bridges
export async function rawSerialOpen(
  port: string,
  baud: number,
  dataBits: number,
  parity: string,
  stopBits: number
): Promise<void> {
  await (AppMethods as any).RawSerialOpen(port, baud, dataBits, parity, stopBits);
}

export async function rawSerialClose(): Promise<void> {
  await (AppMethods as any).RawSerialClose();
}

export async function rawSerialSend(
  text: string,
  isHex: boolean,
  appendCrc: string
): Promise<number> {
  return await (AppMethods as any).RawSerialSend(text, isHex, appendCrc);
}

export async function rawSerialSetDTR(val: boolean): Promise<void> {
  await (AppMethods as any).RawSerialSetDTR(val);
}

export async function rawSerialSetRTS(val: boolean): Promise<void> {
  await (AppMethods as any).RawSerialSetRTS(val);
}

export async function rawSerialIsOpen(): Promise<boolean> {
  try {
    return await (AppMethods as any).RawSerialIsOpen();
  } catch {
    return false;
  }
}

export async function rawSerialGetPort(): Promise<string> {
  try {
    return await (AppMethods as any).RawSerialGetPort();
  } catch {
    return '';
  }
}

// --- Modbus TCP <-> RTU Gateway Bridge ---

export async function gatewayStart(cfg: {
  tcp_port: number;
  serial_port: string;
  baud_rate: number;
  data_bits: number;
  parity: string;
  stop_bits: number;
  timeout_ms: number;
}): Promise<void> {
  await (AppMethods as any).GatewayStart(cfg);
}

export async function gatewayStop(): Promise<void> {
  await (AppMethods as any).GatewayStop();
}

export async function gatewayGetStats(): Promise<any> {
  try {
    return await (AppMethods as any).GatewayGetStats();
  } catch {
    return { is_running: false };
  }
}

export function subscribeGatewayTraffic(callback: (event: any) => void): () => void {
  return WailsRuntime.EventsOn('gateway-traffic', callback);
}

// --- SQLite Overnight Datalogger Engine ---

export async function datalogStartSession(name: string, intervalSec: number, pointCount: number): Promise<string> {
  return await (AppMethods as any).DatalogStartSession(name, intervalSec, pointCount);
}

export async function datalogStopSession(sessID = ''): Promise<void> {
  await (AppMethods as any).DatalogStopSession(sessID);
}

export async function datalogLogBatch(sessID: string, records: any[]): Promise<void> {
  await (AppMethods as any).DatalogLogBatch(sessID, records);
}

export async function datalogListSessions(): Promise<any[]> {
  try {
    return await (AppMethods as any).DatalogListSessions();
  } catch {
    return [];
  }
}

export async function datalogGetRecords(sessID: string, limit = 1000, offset = 0): Promise<any[]> {
  try {
    return await (AppMethods as any).DatalogGetRecords(sessID, limit, offset);
  } catch {
    return [];
  }
}

export async function datalogExportCSV(sessID: string, destPath: string): Promise<number> {
  return await (AppMethods as any).DatalogExportCSV(sessID, destPath);
}

export async function datalogDeleteSession(sessID: string): Promise<void> {
  await (AppMethods as any).DatalogDeleteSession(sessID);
}

