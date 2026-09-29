import { DataFormat, MultiColumnDecoded } from '../types/modbus';

/**
 * Decode 48-bit Unsigned Integer Big-Endian (3 registers / 6 bytes): (R0 << 32) | (R1 << 16) | R2
 */
export function decodeUInt48BE(r0: number, r1: number, r2: number): bigint {
  const b0 = BigInt((r0 ?? 0) & 0xffff);
  const b1 = BigInt((r1 ?? 0) & 0xffff);
  const b2 = BigInt((r2 ?? 0) & 0xffff);
  return (b0 << 32n) | (b1 << 16n) | b2;
}

/**
 * Decode 48-bit Unsigned Integer Little-Endian Word Swap (3 registers / 6 bytes): (R2 << 32) | (R1 << 16) | R0
 */
export function decodeUInt48LE(r0: number, r1: number, r2: number): bigint {
  const b0 = BigInt((r0 ?? 0) & 0xffff);
  const b1 = BigInt((r1 ?? 0) & 0xffff);
  const b2 = BigInt((r2 ?? 0) & 0xffff);
  return (b2 << 32n) | (b1 << 16n) | b0;
}

/**
 * Decode 48-bit BCD (Binary Coded Decimal - 12 digits across 6 bytes)
 * Widely used by European & Asian industrial water meters (Zenner, George Fischer, Kent...)
 */
export function decodeBCD48(
  r0: number,
  r1: number,
  r2: number,
  le: boolean = false
): { valid: boolean; text: string; num: number } {
  const regs = le ? [r2 ?? 0, r1 ?? 0, r0 ?? 0] : [r0 ?? 0, r1 ?? 0, r2 ?? 0];
  let digits = '';

  for (const reg of regs) {
    const b1 = (reg >> 8) & 0xff;
    const b2 = reg & 0xff;
    const d1 = (b1 >> 4) & 0x0f;
    const d2 = b1 & 0x0f;
    const d3 = (b2 >> 4) & 0x0f;
    const d4 = b2 & 0x0f;

    if (d1 > 9 || d2 > 9 || d3 > 9 || d4 > 9) {
      return { valid: false, text: 'Invalid BCD', num: 0 };
    }
    digits += `${d1}${d2}${d3}${d4}`;
  }

  // Remove leading zeros for clean display, but keep at least 1 zero if all zeros
  const trimmed = digits.replace(/^0+(?!$)/, '');
  const parsed = parseInt(digits, 10);
  return { valid: true, text: trimmed, num: parsed };
}

/**
 * Decode 64-bit Unsigned Integer (4 registers / 8 bytes)
 */
export function decodeUInt64(r0: number, r1: number, r2: number, r3: number): bigint {
  const b0 = BigInt((r0 ?? 0) & 0xffff);
  const b1 = BigInt((r1 ?? 0) & 0xffff);
  const b2 = BigInt((r2 ?? 0) & 0xffff);
  const b3 = BigInt((r3 ?? 0) & 0xffff);
  return (b0 << 48n) | (b1 << 32n) | (b2 << 16n) | b3;
}

/**
 * Decode 64-bit Signed Integer (4 registers / 8 bytes)
 */
export function decodeInt64(r0: number, r1: number, r2: number, r3: number): bigint {
  const u = decodeUInt64(r0, r1, r2, r3);
  const maxSigned = 1n << 63n;
  if (u >= maxSigned) {
    return u - (1n << 64n);
  }
  return u;
}

/**
 * Decode Float32 with 4 byte/word order variations
 */
export function decodeFloat32(
  high: number,
  low: number,
  mode: 'float_abcd' | 'float_cdab' | 'float_badc' | 'float_dcba'
): number {
  const buffer = new ArrayBuffer(4);
  const u8 = new Uint8Array(buffer);
  const h_hi = (high >> 8) & 0xff;
  const h_lo = high & 0xff;
  const l_hi = (low >> 8) & 0xff;
  const l_lo = low & 0xff;

  if (mode === 'float_abcd') {
    u8[0] = h_hi;
    u8[1] = h_lo;
    u8[2] = l_hi;
    u8[3] = l_lo;
  } else if (mode === 'float_cdab') {
    u8[0] = l_hi;
    u8[1] = l_lo;
    u8[2] = h_hi;
    u8[3] = h_lo;
  } else if (mode === 'float_badc') {
    u8[0] = h_lo;
    u8[1] = h_hi;
    u8[2] = l_lo;
    u8[3] = l_hi;
  } else if (mode === 'float_dcba') {
    u8[0] = l_lo;
    u8[1] = l_hi;
    u8[2] = h_lo;
    u8[3] = h_hi;
  }

  const view = new DataView(buffer);
  return view.getFloat32(0, false);
}

/**
 * Format a 16-bit or multi-word value based on chosen DataFormat
 */
/** Number of registers a value in this format occupies. */
export function formatWidth(format: DataFormat): number {
  switch (format) {
    case 'float_abcd':
    case 'float_cdab':
    case 'float_badc':
    case 'float_dcba':
    case 'long_abcd':
    case 'long_cdab':
    case 'uint32_abcd':
    case 'uint32_cdab':
      return 2;
    case 'water_48_be':
    case 'water_48_le':
    case 'water_48_bcd':
      return 3;
    case 'int64':
    case 'uint64':
      return 4;
    default:
      return 1;
  }
}

/** Decimals implied by a scale factor: 0.1 -> 1, 0.001 -> 3, 0.25 -> 2, 10 -> 0. */
export function scaleDecimals(scaling: number): number {
  if (!Number.isFinite(scaling) || Number.isInteger(scaling)) return 0;
  const text = scaling.toFixed(10).replace(/0+$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(10, text.length - dot - 1);
}

/** Applies a scale factor and shows exactly the precision the factor gives. */
function formatScaled(raw: number, scaling: number): string {
  if (scaling === 1) return raw.toString();
  return (raw * scaling).toFixed(scaleDecimals(scaling));
}

/** Same for 48/64-bit values; exact below 2^53 (all 48-bit meters). */
function formatScaledBig(raw: bigint, scaling: number): string {
  if (scaling === 1) return raw.toString();
  return (Number(raw) * scaling).toFixed(scaleDecimals(scaling));
}

/** float32 carries ~7 significant digits; toFixed(4) would show 1e-5 as "0". */
function formatFloat(v: number): string {
  if (isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  return Number(v.toPrecision(7)).toString();
}

export function formatValue(
  values: number[],
  index: number,
  format: DataFormat,
  scaling: number = 1
): { display: string; hex: string } {
  const v16 = values[index] ?? 0;
  const hex16 = `0x${v16.toString(16).toUpperCase().padStart(4, '0')}`;

  // A multi-register value on the last rows would read missing registers as 0 and show a
  // plausible but wrong number.
  if (index + formatWidth(format) > values.length) {
    return { display: '--', hex: hex16 };
  }

  switch (format) {
    case 'unsigned16': {
      return {
        display: formatScaled(v16, scaling),
        hex: hex16,
      };
    }

    case 'signed16': {
      const s16 = v16 > 32767 ? v16 - 65536 : v16;
      return {
        display: formatScaled(s16, scaling),
        hex: hex16,
      };
    }

    case 'hex16': {
      return {
        display: hex16,
        hex: hex16,
      };
    }

    case 'bin16': {
      const bin = v16.toString(2).padStart(16, '0');
      const formatted = `${bin.slice(0, 4)} ${bin.slice(4, 8)} ${bin.slice(8, 12)} ${bin.slice(12, 16)}`;
      return {
        display: formatted,
        hex: hex16,
      };
    }

    case 'float_abcd':
    case 'float_cdab':
    case 'float_badc':
    case 'float_dcba': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      const f32 = decodeFloat32(high, low, format);
      const combinedHex = `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`;

      if (isNaN(f32)) {
        return { display: 'NaN', hex: combinedHex };
      }
      return {
        display: scaling === 1 ? formatFloat(f32) : (f32 * scaling).toFixed(Math.max(scaleDecimals(scaling), 3)),
        hex: combinedHex,
      };
    }

    case 'long_abcd': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      const int32 = ((high << 16) | low) | 0;
      return {
        display: formatScaled(int32, scaling),
        hex: `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    case 'long_cdab': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      const int32 = ((low << 16) | high) | 0;
      return {
        display: formatScaled(int32, scaling),
        hex: `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    case 'uint32_abcd': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      const u32 = (((high >>> 0) << 16) | (low & 0xffff)) >>> 0;
      return {
        display: formatScaled(u32, scaling),
        hex: `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    case 'uint32_cdab': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      const u32 = (((low >>> 0) << 16) | (high & 0xffff)) >>> 0;
      return {
        display: formatScaled(u32, scaling),
        hex: `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    case 'int64': {
      const r0 = v16;
      const r1 = values[index + 1] ?? 0;
      const r2 = values[index + 2] ?? 0;
      const r3 = values[index + 3] ?? 0;
      const i64 = decodeInt64(r0, r1, r2, r3);
      return {
        display: formatScaledBig(i64, scaling),
        hex: `${hex16} 0x${r1.toString(16).padStart(4, '0')} 0x${r2.toString(16).padStart(4, '0')} 0x${r3.toString(16).padStart(4, '0')}`,
      };
    }

    case 'uint64': {
      const r0 = v16;
      const r1 = values[index + 1] ?? 0;
      const r2 = values[index + 2] ?? 0;
      const r3 = values[index + 3] ?? 0;
      const u64 = decodeUInt64(r0, r1, r2, r3);
      return {
        display: formatScaledBig(u64, scaling),
        hex: `${hex16} 0x${r1.toString(16).padStart(4, '0')} 0x${r2.toString(16).padStart(4, '0')} 0x${r3.toString(16).padStart(4, '0')}`,
      };
    }

    case 'water_48_be': {
      // 48-bit Big-Endian (Water Meter 3 registers)
      const r0 = v16;
      const r1 = values[index + 1] ?? 0;
      const r2 = values[index + 2] ?? 0;
      const u48 = decodeUInt48BE(r0, r1, r2);
      return {
        display: formatScaledBig(u48, scaling),
        hex: `${hex16} 0x${r1.toString(16).padStart(4, '0')} 0x${r2.toString(16).padStart(4, '0')}`,
      };
    }

    case 'water_48_le': {
      // 48-bit Little-Endian Word Swap (Water Meter 3 registers)
      const r0 = v16;
      const r1 = values[index + 1] ?? 0;
      const r2 = values[index + 2] ?? 0;
      const u48 = decodeUInt48LE(r0, r1, r2);
      return {
        display: formatScaledBig(u48, scaling),
        hex: `${hex16} 0x${r1.toString(16).padStart(4, '0')} 0x${r2.toString(16).padStart(4, '0')}`,
      };
    }

    case 'water_48_bcd': {
      // 48-bit BCD (12 mechanical digits)
      const r0 = v16;
      const r1 = values[index + 1] ?? 0;
      const r2 = values[index + 2] ?? 0;
      const bcd = decodeBCD48(r0, r1, r2, false);
      return {
        display: bcd.valid && scaling !== 1 ? formatScaled(bcd.num, scaling) : bcd.text,
        hex: `${hex16} 0x${r1.toString(16).padStart(4, '0')} 0x${r2.toString(16).padStart(4, '0')}`,
      };
    }

    case 'ascii': {
      const c1 = String.fromCharCode((v16 >> 8) & 0xff);
      const c2 = String.fromCharCode(v16 & 0xff);
      const clean = (c: string) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 ? c : '.');
      return {
        display: `${clean(c1)}${clean(c2)}`,
        hex: hex16,
      };
    }

    default:
      return { display: v16.toString(), hex: hex16 };
  }
}

/**
 * Parse an address string or number in either Decimal or Hexadecimal mode.
 * Auto-detects '0x...' or '...h' / '...H' prefixes/suffixes regardless of mode.
 */
export function parseModbusAddress(
  input: string | number,
  mode: 'dec' | 'hex' = 'dec'
): { value: number; isValid: boolean; error?: string } {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0 || input > 65535) {
      return { value: 0, isValid: false, error: 'Địa chỉ phải là số nguyên từ 0 đến 65535' };
    }
    return { value: input, isValid: true };
  }

  const raw = String(input).trim();
  if (!raw) {
    return { value: 0, isValid: false, error: 'Chưa nhập địa chỉ' };
  }

  // Check for explicit Hex syntax: 0x..., 0X..., ...h, ...H, $...
  const lower = raw.toLowerCase();
  let isHex = mode === 'hex';

  let cleanStr = raw;
  if (lower.startsWith('0x')) {
    isHex = true;
    cleanStr = raw.slice(2);
  } else if (lower.startsWith('$') || lower.startsWith('#')) {
    isHex = true;
    cleanStr = raw.slice(1);
  } else if (lower.endsWith('h')) {
    isHex = true;
    cleanStr = raw.slice(0, -1);
  }

  // The whole string must be digits: parseInt("123abc") would silently return 123.
  const wellFormed = isHex ? /^[0-9a-f]{1,4}$/i.test(cleanStr) : /^\d{1,5}$/.test(cleanStr);
  const parsed = wellFormed ? parseInt(cleanStr, isHex ? 16 : 10) : NaN;
  if (isNaN(parsed) || parsed < 0 || parsed > 65535) {
    return {
      value: 0,
      isValid: false,
      error: isHex ? 'Địa chỉ Hex không hợp lệ (0x0000 - 0xFFFF)' : 'Địa chỉ Dec không hợp lệ (0 - 65535)',
    };
  }

  return { value: parsed, isValid: true };
}

/**
 * Format address number to string based on mode.
 */
export function formatModbusAddress(
  address: number,
  mode: 'dec' | 'hex',
  prefix: boolean = true
): string {
  const safe = Math.max(0, Math.min(65535, address || 0));
  if (mode === 'hex') {
    const hexStr = safe.toString(16).toUpperCase().padStart(4, '0');
    return prefix ? `0x${hexStr}` : hexStr;
  }
  return safe.toString(10);
}

/**
 * Modicon-style reference number: table digit + (address + 1), 5 digits (40001..49999) up to
 * address 9998 and 6 digits (410000..465536) above, so 10000 is never shown as 40001-like
 * labels of another table.
 */
export function modiconAddress(tableDigit: 0 | 1 | 3 | 4, address: number): string {
  return `${tableDigit}${String(address + 1).padStart(4, '0')}`;
}

/** Modicon table digit for a function code or slave table. */
export function modiconTableDigit(fcOrTable: number | string): 0 | 1 | 3 | 4 {
  switch (fcOrTable) {
    case 1:
    case 'coils':
      return 0;
    case 2:
    case 'discrete':
      return 1;
    case 4:
    case 'input':
      return 3;
    default:
      return 4;
  }
}

/**
 * Standard Modbus register address display string (FC01 0xxxx, FC02 1xxxx, FC03 4xxxx,
 * FC04 3xxxx; 6 digits from address 9999 up), or 0x-hex in hex mode.
 */
export function getModbusAddressLabel(
  functionCode: number,
  address: number,
  mode: 'dec' | 'hex' = 'dec'
): string {
  if (mode === 'hex') {
    return `0x${(address & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
  }
  if (functionCode < 1 || functionCode > 4) return `${address}`;
  return modiconAddress(modiconTableDigit(functionCode), address);
}

/**
 * Decodes a single register row into all supported data formats simultaneously.
 * Ideal for multi-column format inspection and diagnostic scanning.
 */
export function decodeAllColumns(
  values: number[],
  index: number,
  address: number,
  fc: number = 3
): MultiColumnDecoded {
  const r0 = values[index] ?? 0;
  const r1 = values[index + 1] ?? 0;
  const r2 = values[index + 2] ?? 0;
  const r3 = values[index + 3] ?? 0;

  const hex = `0x${r0.toString(16).toUpperCase().padStart(4, '0')}`;
  const binRaw = r0.toString(2).padStart(16, '0');
  const bin = `${binRaw.slice(0, 4)} ${binRaw.slice(4, 8)} ${binRaw.slice(8, 12)} ${binRaw.slice(12, 16)}`;

  const int16 = r0 > 32767 ? r0 - 65536 : r0;
  const uint16 = r0;

  // 32-bit Integers
  const int32_abcd = ((r0 << 16) | r1) | 0;
  const int32_cdab = ((r1 << 16) | r0) | 0;
  const uint32_abcd = (((r0 >>> 0) << 16) | (r1 & 0xffff)) >>> 0;
  const uint32_cdab = (((r1 >>> 0) << 16) | (r0 & 0xffff)) >>> 0;

  // Float 32
  const f_abcd = decodeFloat32(r0, r1, 'float_abcd');
  const f_cdab = decodeFloat32(r0, r1, 'float_cdab');
  const f_badc = decodeFloat32(r0, r1, 'float_badc');
  const f_dcba = decodeFloat32(r0, r1, 'float_dcba');

  const formatF = formatFloat;
  // Columns wider than the registers left in the block show '--' instead of reading zeros.
  const left = values.length - index;
  const need = <T,>(width: number, v: T): T | string => (left >= width ? v : '--');

  // 64-bit Integers
  const i64 = decodeInt64(r0, r1, r2, r3);
  const u64 = decodeUInt64(r0, r1, r2, r3);

  // 48-bit Water Meter Decoders (3 registers / 6 bytes)
  const w48_be = decodeUInt48BE(r0, r1, r2);
  const w48_le = decodeUInt48LE(r0, r1, r2);
  const bcdRes = decodeBCD48(r0, r1, r2, false);

  // ASCII
  const c1 = String.fromCharCode((r0 >> 8) & 0xff);
  const c2 = String.fromCharCode(r0 & 0xff);
  const clean = (c: string) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 ? c : '.');
  const ascii = `${clean(c1)}${clean(c2)}`;

  return {
    address,
    displayAddress: getModbusAddressLabel(fc, address),
    hex,
    bin,
    int16,
    uint16,
    int32_abcd: need(2, int32_abcd),
    int32_cdab: need(2, int32_cdab),
    uint32_abcd: need(2, uint32_abcd),
    uint32_cdab: need(2, uint32_cdab),
    float_abcd: need(2, formatF(f_abcd)),
    float_cdab: need(2, formatF(f_cdab)),
    float_badc: need(2, formatF(f_badc)),
    float_dcba: need(2, formatF(f_dcba)),
    int64: need(4, i64.toString()),
    uint64: need(4, u64.toString()),
    water_48_be: need(3, w48_be.toString()),
    water_48_le: need(3, w48_le.toString()),
    water_48_bcd: need(3, bcdRes.text),
    ascii,
  };
}

const SINGLE_REGISTER_FORMATS: DataFormat[] = ['signed16', 'unsigned16', 'hex16', 'bin16'];

/** True when a value in this format fits in one 16-bit register (writable with FC06). */
export function isSingleRegisterFormat(format?: DataFormat): boolean {
  return !format || SINGLE_REGISTER_FORMATS.includes(format);
}

export type EncodedRegisters = { ok: true; values: number[] } | { ok: false; error: string };

/**
 * Encode user input according to the chosen DataFormat and scaling factor.
 * Supports:
 * - 16-bit: unsigned16, signed16 (handles negative numbers down to -32768), hex16, bin16 -> 1 register
 * - 32-bit Float: float_abcd, float_cdab, float_badc, float_dcba -> 2 registers
 * - 32-bit Int: long_abcd, long_cdab -> 2 registers
 * - 32-bit UInt: uint32_abcd, uint32_cdab -> 2 registers
 */
// Parses a decimal number and applies scaling. Integer targets reject fractions unless a scale
// factor is set (then the scaled value is rounded to the nearest raw step).
function parseScaled(trimmed: string, scaling: number, integer: boolean): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(parsed)) {
    return { ok: false, error: `Giá trị "${trimmed}" không hợp lệ.` };
  }
  const scaled = scaling !== 1 && scaling !== 0 ? parsed / scaling : parsed;
  if (!integer) return { ok: true, value: scaled };
  if (scaling === 1 || scaling === 0) {
    if (!Number.isInteger(parsed)) return { ok: false, error: 'Định dạng số nguyên không nhận số thập phân.' };
    return { ok: true, value: parsed };
  }
  return { ok: true, value: Math.round(scaled) };
}

/**
 * `format` undefined means a raw 16-bit write (Write dialog): -32768..65535 is accepted and
 * negatives are stored as two's complement. Typed formats enforce their own range, checked on
 * the raw value after scaling.
 */
export function encodeRegisterInput(
  input: string,
  format: DataFormat | undefined,
  scaling = 1
): EncodedRegisters {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Chưa nhập giá trị.' };
  }

  // 1. Single register formats (16-bit)
  if (isSingleRegisterFormat(format)) {
    const compactBin = trimmed.replace(/[\s_]/g, '');
    let num: number;

    if (/^0x[0-9a-f]{1,4}$/i.test(trimmed)) {
      num = parseInt(trimmed.slice(2), 16);
    } else if (/^0b[01]{1,16}$/i.test(compactBin) || (format === 'bin16' && /^[01]{1,16}$/.test(compactBin))) {
      num = parseInt(compactBin.replace(/^0b/i, ''), 2);
    } else {
      const res = parseScaled(trimmed, scaling, true);
      if (!res.ok) return res;
      num = res.value;
    }

    // Hex/binary literals are raw bit patterns and always fit; decimal values must fit the format.
    const isLiteral = /^0x/i.test(trimmed) || /^0b/i.test(compactBin) || (format === 'bin16' && /^[01]{1,16}$/.test(compactBin));
    const [min, max] =
      isLiteral ? [0, 65535] :
      format === 'signed16' ? [-32768, 32767] :
      format === 'unsigned16' || format === 'hex16' || format === 'bin16' ? [0, 65535] :
      [-32768, 65535];
    if (num < min || num > max) {
      const label = format ? `định dạng ${format}` : 'thanh ghi 16-bit';
      return { ok: false, error: `Giá trị raw ${num} nằm ngoài phạm vi ${label} (${min} đến ${max}).` };
    }
    return { ok: true, values: [num & 0xffff] };
  }

  // 2. 32-bit Float formats (2 registers)
  if (format === 'float_abcd' || format === 'float_cdab' || format === 'float_badc' || format === 'float_dcba') {
    const res = parseScaled(trimmed, scaling, false);
    if (!res.ok) return res;
    const fVal = res.value;
    // float32 overflows to Infinity above ~3.4e38; never write that silently.
    if (!Number.isFinite(Math.fround(fVal))) {
      return { ok: false, error: `Giá trị ${fVal} vượt phạm vi float32 (±3.4e38).` };
    }

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, fVal, false); // IEEE-754 Big Endian bytes
    const b0 = view.getUint8(0);
    const b1 = view.getUint8(1);
    const b2 = view.getUint8(2);
    const b3 = view.getUint8(3);

    let high = 0;
    let low = 0;

    if (format === 'float_abcd') {
      high = (b0 << 8) | b1;
      low = (b2 << 8) | b3;
    } else if (format === 'float_cdab') {
      high = (b2 << 8) | b3;
      low = (b0 << 8) | b1;
    } else if (format === 'float_badc') {
      high = (b1 << 8) | b0;
      low = (b3 << 8) | b2;
    } else if (format === 'float_dcba') {
      high = (b3 << 8) | b2;
      low = (b1 << 8) | b0;
    }

    return { ok: true, values: [high & 0xffff, low & 0xffff] };
  }

  // 3. 32-bit Signed Integer formats (2 registers)
  if (format === 'long_abcd' || format === 'long_cdab') {
    const res = parseScaled(trimmed, scaling, true);
    if (!res.ok) return res;
    const iVal = res.value;
    if (iVal < -2147483648 || iVal > 2147483647) {
      return { ok: false, error: `Giá trị ${iVal} nằm ngoài phạm vi 32-bit (-2147483648 đến 2147483647).` };
    }
    const int32 = iVal | 0;

    let high = 0;
    let low = 0;
    if (format === 'long_abcd') {
      high = (int32 >>> 16) & 0xffff;
      low = int32 & 0xffff;
    } else {
      // In decode: ((low << 16) | high) | 0
      high = int32 & 0xffff;
      low = (int32 >>> 16) & 0xffff;
    }
    return { ok: true, values: [high, low] };
  }

  // 4. 32-bit Unsigned Integer formats (2 registers)
  if (format === 'uint32_abcd' || format === 'uint32_cdab') {
    const res = parseScaled(trimmed, scaling, true);
    if (!res.ok) return res;
    const uVal = res.value;
    // Check the raw value after scaling: `>>> 0` would silently wrap anything outside uint32.
    if (uVal < 0 || uVal > 4294967295) {
      return { ok: false, error: `Giá trị raw ${uVal} nằm ngoài phạm vi UInt32 (0 đến 4294967295).` };
    }
    const u32 = uVal >>> 0;

    let high = 0;
    let low = 0;
    if (format === 'uint32_abcd') {
      high = (u32 >>> 16) & 0xffff;
      low = u32 & 0xffff;
    } else {
      // In decode: ((low >>> 0) << 16) | (high & 0xffff)
      high = u32 & 0xffff;
      low = (u32 >>> 16) & 0xffff;
    }
    return { ok: true, values: [high, low] };
  }

  return {
    ok: false,
    error: `Chưa hỗ trợ ghi trực tiếp cho định dạng ${format}.`,
  };
}

export type ParsedRegister = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse user input into a raw 16-bit register value (for modals or single-cell edits).
 */
export function parseRegisterInput(input: string, format?: DataFormat, scaling = 1): ParsedRegister {
  if (format && !isSingleRegisterFormat(format)) {
    // Returning only values[0] would silently write half of a 32-bit value.
    return { ok: false, error: `Định dạng ${format} chiếm nhiều thanh ghi; dùng encodeRegisterInput.` };
  }
  const res = encodeRegisterInput(input, format, scaling);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  return { ok: true, value: res.values[0] };
}
