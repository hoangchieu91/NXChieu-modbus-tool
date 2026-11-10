import {
  DataFormat,
  PollDefinition,
  RegisterRow,
  SlaveConfig,
  TabSession,
  TrafficEntry,
  ConnectionConfig,
} from '../types/modbus';
import {
  formatValue,
  getModbusAddressLabel,
  decodeAllColumns,
  modiconAddress,
  modiconTableDigit,
} from './formatters';

// HH:MM:SS.mmm shown in the grid, traffic log and chart.
export const clockStamp = (d: Date): string =>
  d.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');

// Whether a tab shows bit values (coils / discrete inputs) rather than registers.
export const isCoilTab = (tab: TabSession): boolean =>
  tab.role === 'slave'
    ? tab.slaveTable === 'coils' || tab.slaveTable === 'discrete'
    : tab.definition.function_code === 1 || tab.definition.function_code === 2;

// FC02 (Discrete Inputs) and FC04 (Input Registers) are read-only tables on a Modbus device.
export const isReadOnlyFunction = (fc: number): boolean => fc === 2 || fc === 4;

// Numeric value plotted on the trend chart. Text formats (hex/bin/ascii) do not parse as numbers,
// so they fall back to the scaled raw register instead of a flat 0.
export const toChartValue = (values: number[], idx: number, fmt: DataFormat, scaling: number): number => {
  if (fmt === 'hex16' || fmt === 'bin16' || fmt === 'ascii') return values[idx] * scaling;
  const display = formatValue(values, idx, fmt, scaling).display;
  if (display === '--') return NaN; // value spans registers outside the read block
  const parsed = parseFloat(display.replace(/,/g, ''));
  return isNaN(parsed) ? values[idx] * scaling : parsed;
};

export type TracePoint = { timestamp: string; timeMs: number; value: number };

// Value a trace samples from a read result: a register (decoded with its format) or a coil as 0/1.
export const sampleTrace = (
  values: number[],
  bools: boolean[],
  idx: number,
  fmt: DataFormat,
  scaling: number
): number => {
  if (values.length === 0 && bools.length > 0) {
    return idx >= 0 && idx < bools.length ? (bools[idx] ? 1 : 0) : NaN;
  }
  return idx >= 0 && idx < values.length ? toChartValue(values, idx, fmt, scaling) : NaN;
};

// Appends one point per trace in a single state update, keeping the last 300 points.
export const appendTracePoints = (
  prev: Record<string, TracePoint[]>,
  points: Record<string, TracePoint>
): Record<string, TracePoint[]> => {
  const next = { ...prev };
  for (const [id, point] of Object.entries(points)) {
    next[id] = [...(prev[id] || []).slice(-299), point];
  }
  return next;
};

export const DEFAULT_DEFINITION: PollDefinition = {
  slave_id: 1,
  function_code: 3, // Read Holding Registers
  start_address: 0,
  quantity: 10,
  scan_rate_ms: 1000,
};

export const DEFAULT_SLAVE_CONFIG: SlaveConfig = {
  type: 'tcp',
  host: '0.0.0.0',
  port_tcp: 5020,
  slave_id: 1,
};

export interface PerTabState {
  isConnected: boolean;
  isPolling: boolean;
  connectionConfig: ConnectionConfig | null;
  txCount: number;
  errCount: number;
  latencyMs: number;
  traffic: TrafficEntry[];
  hasData: boolean;
  regs: number[];
  coils: boolean[];
  lastValues: (number | boolean)[];
  slaveActivityCount: number;
  isListening: boolean;
  isSimulating: boolean;
  lastUpdatedMap: Record<number, string>;
  lastUpdatedTime?: string;
}

export const INITIAL_TAB: TabSession = {
  id: 'tab-master-poll-1',
  title: 'Phiên Đọc 1 (Master)',
  role: 'master',
  definition: {
    slave_id: 1,
    function_code: 3,
    start_address: 0,
    quantity: 20,
    scan_rate_ms: 1000,
  },
  format: 'unsigned16',
  formats: {},
  aliases: {},
  units: {},
  scalings: {},
  controls: {},
  slaveConfig: {
    type: 'serial',
    port: 'COM1',
    baud_rate: 9600,
    data_bits: 8,
    parity: 'none',
    stop_bits: 1,
    slave_id: 1,
    slave_id_end: 1,
  },
  slaveTable: 'holding',
  slaveStartAddr: 0,
  slaveQuantity: 20,
};

export const createEmptyTabState = (): PerTabState => ({
  isConnected: false,
  isPolling: false,
  connectionConfig: null,
  txCount: 0,
  errCount: 0,
  latencyMs: 0,
  traffic: [],
  hasData: false,
  regs: [],
  coils: [],
  lastValues: [],
  slaveActivityCount: 0,
  isListening: false,
  isSimulating: false,
  lastUpdatedMap: {},
});

// Pure function of the tab config and its live state; memoized by callers so rows (and the
// multi-column decodes) are rebuilt only when data changes, not on every App render.
export function buildRowsForTab(
  tab: TabSession,
  state: PerTabState
): { rows: RegisterRow[]; isCoil: boolean } {
  const isCoil = isCoilTab(tab);

  const startAddr = tab.role === 'slave' ? tab.slaveStartAddr : tab.definition.start_address;
  const quantity = tab.role === 'slave' ? tab.slaveQuantity : tab.definition.quantity;
  const disabledSet = new Set<number>(tab.role === 'slave' ? [] : (tab.definition.disabled_addrs || []));

  const resultRows: RegisterRow[] = [];
  for (let i = 0; i < quantity; i++) {
    const addr = startAddr + i;
    const isDisabled = disabledSet.has(addr);
    const alias = tab.aliases[addr] || '';
    const unit = tab.units[addr] || '';
    const scaling = tab.scalings[addr] ?? 1;
    const rowFormat = tab.formats?.[addr];

    let rawVal: number | boolean | null = null;
    let displayVal = isDisabled ? 'CẤM ĐỌC' : '--';
    let rawHex = isDisabled ? 'SKIP' : '--';
    let changed = false;
    let changeDirection: 'up' | 'down' | null = null;
    let decodedMulti: import('../types/modbus').MultiColumnDecoded | undefined = undefined;

    const hasData = tab.role === 'slave' ? true : state.hasData;
    let cellHasValue = false;

    if (hasData && !isDisabled) {
      if (isCoil) {
        if (i < state.coils.length) {
          const bit = state.coils[i];
          const prevBit = (state.lastValues[i] as boolean) ?? bit;
          rawVal = bit;
          displayVal = bit ? 'ON' : 'OFF';
          rawHex = bit ? '0x01' : '0x00';
          changed = bit !== prevBit;
          if (changed) {
            changeDirection = bit ? 'up' : 'down';
          }
          cellHasValue = true;
        }
      } else {
        if (i < state.regs.length) {
          const v = state.regs[i];
          const prevV = (state.lastValues[i] as number) ?? v;
          rawVal = v;
          const effectiveFmt = rowFormat || tab.format;
          const fmtRes = formatValue(state.regs, i, effectiveFmt, scaling);
          displayVal = fmtRes.display;
          rawHex = fmtRes.hex;
          changed = v !== prevV;
          if (changed) {
            changeDirection = v > prevV ? 'up' : 'down';
          }
          cellHasValue = true;
          decodedMulti = decodeAllColumns(state.regs, i, addr, tab.definition.function_code);
        }
      }
    }

    let displayAddress = '';
    if (tab.role === 'slave') {
      displayAddress = `${modiconAddress(modiconTableDigit(tab.slaveTable), addr)} (${addr})`;
    } else {
      displayAddress = getModbusAddressLabel(tab.definition.function_code, addr);
    }

    const lastUpdated = isDisabled ? undefined : (state.lastUpdatedMap?.[addr] || (cellHasValue ? state.lastUpdatedTime : undefined));

    resultRows.push({
      address: addr,
      displayAddress,
      alias,
      rawValue: rawVal,
      displayValue: displayVal,
      rawHex,
      unit,
      scaling,
      format: rowFormat,
      lastUpdated,
      changed,
      changeDirection,
      hasValue: cellHasValue,
      disabled: isDisabled,
      decodedMulti,
      control: tab.controls?.[addr],
    });
  }

  return { rows: resultRows, isCoil };
}
