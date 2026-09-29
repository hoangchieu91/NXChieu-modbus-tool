export type DataFormat =
  | 'signed16'
  | 'unsigned16'
  | 'hex16'
  | 'bin16'
  | 'float_abcd'
  | 'float_cdab'
  | 'float_badc'
  | 'float_dcba'
  | 'long_abcd'
  | 'long_cdab'
  | 'uint32_abcd'
  | 'uint32_cdab'
  | 'int64'
  | 'uint64'
  | 'water_48_be'
  | 'water_48_le'
  | 'water_48_bcd'
  | 'ascii';


export interface SerialPortDetail {
  port_name: string;
  description?: string;
  hardware_id?: string;
}

export type ConnectionConfig =
  | {
      type: 'serial';
      port: string;
      baud_rate: number;
      data_bits: number;
      parity: string;
      stop_bits: number;
      timeout_ms: number;
    }
  | {
      type: 'tcp';
      host: string;
      port: number;
      timeout_ms: number;
    }
  | {
      type: 'rtu_over_tcp';
      host: string;
      port: number;
      timeout_ms: number;
    };

export interface PollDefinition {
  slave_id: number;
  function_code: number; // 1: Coils, 2: Discrete, 3: Holding, 4: Input
  start_address: number;
  quantity: number;
  scan_rate_ms: number;
}

export interface PollResult {
  session_id?: string;
  timestamp: string;
  /** Request that produced this result (may differ from the tab's current definition). */
  slave_id?: number;
  function_code?: number;
  start_address?: number;
  values: number[];
  bool_values: boolean[];
  is_coil: boolean;
  tx_count: number;
  err_count: number;
  latency_ms: number;
  error?: string | null;
  raw_tx?: string | null;
  raw_rx?: string | null;
}

export interface TrafficEntry {
  id: string;
  timestamp: string;
  direction: 'tx' | 'rx' | 'err';
  hex: string;
  description?: string;
}

export interface RegisterRow {
  address: number;
  displayAddress: string;
  alias: string;
  rawValue: number | boolean | null;
  displayValue: string;
  rawHex: string;
  unit: string;
  scaling: number;
  format?: DataFormat;
  lastUpdated?: string;
  changed: boolean;
  changeDirection?: 'up' | 'down' | null;
  hasValue: boolean;
  decodedMulti?: MultiColumnDecoded;
}


export type SessionRole = 'master' | 'slave';
export type SlaveTable = 'holding' | 'coils' | 'discrete' | 'input';

export interface SlaveConfig {
  type: 'tcp' | 'serial' | 'rtu_over_tcp';
  host?: string;
  port_tcp?: number;
  port?: string;
  baud_rate?: number;
  data_bits?: number;
  parity?: string;
  stop_bits?: number;
  slave_id: number;
}

export interface SlaveMemorySlice {
  session_id: string;
  table: string;
  start_address: number;
  quantity: number;
  values?: number[];
  bool_values?: boolean[];
}

export interface SlaveActivityEvent {
  session_id: string;
  timestamp: string;
  client: string;
  function: string;
  address: number;
  quantity: number;
  is_write: boolean;
  values?: number[];
  bools?: boolean[];
  summary: string;
  hex_raw?: string;
}

export interface SimulationConfig {
  session_id: string;
  table: string;
  address: number;
  mode: 'increment' | 'random' | 'sine' | 'toggle';
  min: number;
  max: number;
  step: number;
  interval_ms: number;
}

export interface TabSession {
  id: string;
  title: string;
  role: SessionRole;
  definition: PollDefinition;
  format: DataFormat;
  formats?: Record<number, DataFormat>;
  aliases: Record<number, string>;
  units: Record<number, string>;
  scalings: Record<number, number>;
  // Slave settings
  slaveConfig?: SlaveConfig;
  slaveTable: SlaveTable;
  slaveStartAddr: number;
  slaveQuantity: number;
  isListening?: boolean;
  isSimulating?: boolean;
}

export interface ChartDataPoint {
  timestamp: string;
  timeMs: number;
  value: number;
}

export interface ChartTrace {
  id: string; // `${tabId}_${address}`
  tabId: string;
  tabTitle: string;
  address: number;
  label: string;
  unit: string;
  displayAddress: string;
  color: string;
  visible: boolean;
}

export interface ChartTarget {
  tabId: string;
  address: number;
  label: string;
  unit: string;
  displayAddress: string;
}

export interface WriteRegisterParam {
  slave_id: number;
  address: number;
  value: number;
}

export interface WriteRegistersParam {
  slave_id: number;
  address: number;
  values: number[];
}

export interface WriteCoilParam {
  slave_id: number;
  address: number;
  value: boolean;
}

export interface SlaveScanItem {
  slave_id: number;
  status: 'online' | 'exception' | 'offline' | string;
  detail: string;
  latency_ms: number;
  raw_rx?: string;
}

export interface BaudScanItem {
  baud_rate: number;
  parity: string;
  stop_bits: number;
  success: boolean;
  latency_ms: number;
  detail: string;
}

export interface RegisterScanItem {
  address: number;
  valid: boolean;
  value: number;
  hex: string;
  detail: string;
}

export interface MultiColumnDecoded {
  address: number;
  displayAddress: string;
  hex: string;
  bin: string;
  int16: number;
  uint16: number;
  int32_abcd: number;
  int32_cdab: number;
  uint32_abcd: number;
  uint32_cdab: number;
  float_abcd: string;
  float_cdab: string;
  float_badc: string;
  float_dcba: string;
  int64: string;
  uint64: string;
  water_48_be: string;
  water_48_le: string;
  water_48_bcd: string;
  ascii: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  type: 'vpn_tailscale' | 'vpn' | 'lan' | 'wifi' | 'other' | string;
  description: string;
  url: string;
}

export interface RemoteServerStatus {
  is_running: boolean;
  port: number;
  allow_write: boolean;
  active_clients: number;
  /** Access token required by /ws and /api/write; already included in each interface URL. */
  token: string;
  interfaces: NetworkInterfaceInfo[];
}

