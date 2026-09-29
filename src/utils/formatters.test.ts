import { describe, expect, it } from 'vitest';
import {
  decodeAllColumns,
  encodeRegisterInput,
  formatValue,
  getModbusAddressLabel,
  parseModbusAddress,
  parseRegisterInput,
} from './formatters';

describe('encodeRegisterInput', () => {
  it('checks the UInt32 range after scaling instead of wrapping', () => {
    expect(encodeRegisterInput('1000000000', 'uint32_abcd', 0.1).ok).toBe(false);
    expect(encodeRegisterInput('400000000', 'uint32_abcd', 0.1)).toEqual({ ok: true, values: [61035, 10240] });
  });

  it('enforces signed/unsigned 16-bit ranges per format', () => {
    expect(encodeRegisterInput('-1', 'unsigned16', 1).ok).toBe(false);
    expect(encodeRegisterInput('65535', 'signed16', 1).ok).toBe(false);
    expect(encodeRegisterInput('-1', 'signed16', 1)).toEqual({ ok: true, values: [0xffff] });
    expect(encodeRegisterInput('0xFFFF', 'signed16', 1)).toEqual({ ok: true, values: [0xffff] });
  });

  it('rejects fractions for integer formats without scaling, rounds with scaling', () => {
    expect(encodeRegisterInput('12.7', 'long_abcd', 1).ok).toBe(false);
    expect(encodeRegisterInput('12.7', 'long_abcd', 0.1)).toEqual({ ok: true, values: [0, 127] });
    expect(encodeRegisterInput('22.05', 'unsigned16', 0.1)).toEqual({ ok: true, values: [221] });
  });

  it('rejects float32 overflow', () => {
    expect(encodeRegisterInput('1e39', 'float_abcd', 1).ok).toBe(false);
    expect(encodeRegisterInput('3.5', 'float_abcd', 1)).toEqual({ ok: true, values: [0x4060, 0] });
  });
});

describe('parseRegisterInput (raw write dialog)', () => {
  it('accepts two\'s complement negatives', () => {
    expect(parseRegisterInput('-1')).toEqual({ ok: true, value: 65535 });
  });
  it('never returns half of a multi-register value', () => {
    expect(parseRegisterInput('1', 'float_abcd').ok).toBe(false);
  });
});

describe('formatValue', () => {
  it('shows the precision given by the scale factor', () => {
    expect(formatValue([1234], 0, 'unsigned16', 0.001).display).toBe('1.234');
    expect(formatValue([2205], 0, 'unsigned16', 0.1).display).toBe('220.5');
    expect(formatValue([7], 0, 'unsigned16', 1).display).toBe('7');
  });

  it('keeps small floats', () => {
    expect(formatValue([0x3727, 0xc5ac], 0, 'float_abcd', 1).display).toBe('0.00001');
  });

  it('applies scaling to 48-bit and BCD meters', () => {
    expect(formatValue([0, 0x12, 0xd687], 0, 'water_48_be', 0.001).display).toBe('1234.567');
    expect(formatValue([0x0000, 0x0123, 0x4567], 0, 'water_48_bcd', 0.001).display).toBe('1234.567');
  });

  it('shows -- when a multi-register value runs past the read block', () => {
    expect(formatValue([1, 2, 3], 2, 'float_abcd', 1).display).toBe('--');
    const multi = decodeAllColumns([1, 2, 3], 2, 2, 3);
    expect([multi.int32_abcd, multi.float_abcd, multi.int64]).toEqual(['--', '--', '--']);
  });
});

describe('addresses', () => {
  it('uses 6-digit Modicon labels from address 9999 so tables never collide', () => {
    expect(getModbusAddressLabel(3, 0)).toBe('40001');
    expect(getModbusAddressLabel(3, 9998)).toBe('49999');
    expect(getModbusAddressLabel(3, 9999)).toBe('410000');
    expect(getModbusAddressLabel(4, 10000)).toBe('310001');
    expect(getModbusAddressLabel(1, 10000)).toBe('010001');
  });

  it('rejects addresses with trailing garbage', () => {
    expect(parseModbusAddress('123abc', 'dec').isValid).toBe(false);
    expect(parseModbusAddress('', 'dec').isValid).toBe(false);
    expect(parseModbusAddress('0x1000', 'dec')).toEqual({ value: 4096, isValid: true });
    expect(parseModbusAddress('1000H', 'dec')).toEqual({ value: 4096, isValid: true });
  });
});
