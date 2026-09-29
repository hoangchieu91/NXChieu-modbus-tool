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
  hasValue: boolean;
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

export interface WriteCoilParam {
  slave_id: number;
  address: number;
  value: boolean;
}
