import {
  DataFormat,
  PollDefinition,
  RegisterControlConfig,
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

export function isAliasAutoReadOnly(alias: string): boolean {
  const tag = (alias || '').trim();
  if (!tag) return false;
  if (/WRITE|CLEAR|RESET|CMD|SETPOINT|PULSE|PWM_DUTY|FREQ_SET|_MODE|_BAUD|_PARITY|SLAVE_ID/i.test(tag)) {
    return false;
  }
  if (/^(RL\d+|OUT12V_\d+|RELAY\d*|DO\d+|COIL\d*)\b/i.test(tag)) {
    return false;
  }
  return /\b(DEVICE_ID|FW_VERSION|HW_VERSION|UPTIME|REBOOT_COUNT|DIP_STATE|DI_BITMAP|DO_BITMAP|RELAY_BITMAP|OUT12V_BITMAP|UID_WORD|NTC_TEMP|AI\d+_|MCU_VDDA|MCU_TEMP|DI\d+_STATE|DI\d+_FREQ|DI\d+_CNT|ERR_CNT|OK_CNT|SERIAL_NO|STATUS_WORD)\b/i.test(
    tag
  );
}

export function inferControlFromAlias(alias: string, fnCode: number): RegisterControlConfig | undefined {
  if (fnCode === 2 || fnCode === 4) return { type: 'readonly' };
  const tag = (alias || '').trim();
  if (fnCode === 1) {
    return { type: 'toggle', onValue: 1, offValue: 0 };
  }
  if (isAliasAutoReadOnly(tag)) {
    return { type: 'readonly' };
  }
  const parenMatch = tag.match(/\(([^)]*=[^)]*)\)/);
  if (parenMatch) {
    const opts: { label: string; value: number }[] = [];
    parenMatch[1].split(/[,;|]+/).forEach((part) => {
      const p = part.trim();
      if (!p || /^bit\d/i.test(p)) return;
      const idxEq = p.indexOf('=');
      const idxCol = p.indexOf(':');
      const sep = idxEq >= 0 ? idxEq : idxCol;
      if (sep > 0) {
        const kRaw = p.slice(0, sep).trim();
        const label = p.slice(sep + 1).trim();
        const numMatch = kRaw.match(/(?:^|\s)(0x[0-9a-fA-F]+|-?\d+)\s*$/);
        if (numMatch && label) {
          const tok = numMatch[1];
          const val = tok.startsWith('0x') || tok.startsWith('0X') ? parseInt(tok, 16) : parseInt(tok, 10);
          if (!isNaN(val)) opts.push({ value: val, label: `${val}: ${label}` });
        }
      }
    });
    if (opts.length === 2 && opts[0].value === 0 && opts[1].value === 1 && /ON|OFF|BẬT|TẮT|ENABLE/i.test(parenMatch[1])) {
      return { type: 'toggle', offValue: 0, onValue: 1 };
    }
    if (opts.length >= 2) {
      return { type: opts.length <= 5 ? 'buttons' : 'dropdown', options: opts };
    }
  }
  if (/^(DO_|COIL_|RL\d+_ON|OUT12V\d_ON|OUT12V_\d+)/i.test(tag)) {
    return { type: 'toggle', offValue: 0, onValue: 1 };
  }
  if (/WRITE\s*1\s*CLEAR|CLEAR_ALL|RESET_ERR/i.test(tag)) {
    return {
      type: 'buttons',
      options: [{ value: 1, label: '⚡ Ghi 1 (Clear)' }],
    };
  }
  if (/ghi\s*0xA55A/i.test(tag)) {
    return {
      type: 'buttons',
      options: [
        { value: 0, label: '0: Khóa (Locked)' },
        { value: 0xa55a, label: '42330: Mở Khóa (0xA55A)' },
      ],
    };
  }
  return undefined;
}

export function decodeRegisterStateBadge(
  row: RegisterRow,
  isCoil: boolean
): { text: string; tone: 'on' | 'off' | 'enum' | 'bits' } | null {
  if (!row.hasValue || row.rawValue === null || row.rawValue === undefined || row.disabled) return null;
  const numVal = typeof row.rawValue === 'boolean' ? (row.rawValue ? 1 : 0) : Number(row.rawValue);
  const ctrl = row.control;

  if (isCoil || ctrl?.type === 'toggle') {
    const onVal = ctrl?.onValue ?? 1;
    const isOn = numVal === onVal || (isCoil && Boolean(row.rawValue));
    return {
      text: isOn ? `🟢 ON (${numVal})` : `⚪ OFF (${numVal})`,
      tone: isOn ? 'on' : 'off',
    };
  }
  if ((ctrl?.type === 'dropdown' || ctrl?.type === 'buttons') && ctrl.options && ctrl.options.length > 0) {
    const hit = ctrl.options.find((o) => Number(o.value) === numVal);
    if (hit) {
      return {
        text: `🟣 ${hit.label}`,
        tone: numVal === 0 ? 'off' : 'enum',
      };
    }
  }
  if (/BITMAP|BITMASK|DIP_STATE/i.test(row.alias || '') && Number.isFinite(numVal)) {
    const iv = numVal & 0xffff;
    const activeBits: string[] = [];
    for (let b = 0; b < 16; b++) {
      if ((iv >> b) & 1) activeBits.push(`B${b}`);
    }
    return {
      text: activeBits.length ? `Bits ON: ${activeBits.slice(0, 6).join(',')}` : 'All Bits OFF (0x0000)',
      tone: activeBits.length ? 'bits' : 'off',
    };
  }
  return null;
}

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
      control: tab.controls?.[addr] || inferControlFromAlias(alias, tab.definition.function_code),
    });
  }

  return { rows: resultRows, isCoil };
}
