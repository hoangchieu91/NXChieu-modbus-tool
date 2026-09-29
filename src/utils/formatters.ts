import { DataFormat } from '../types/modbus';

/**
 * Format a 16-bit or pair of 16-bit words based on chosen DataFormat
 */
export function formatValue(
  values: number[],
  index: number,
  format: DataFormat,
  scaling: number = 1
): { display: string; hex: string } {
  const v16 = values[index] ?? 0;
  const hex16 = `0x${v16.toString(16).toUpperCase().padStart(4, '0')}`;

  switch (format) {
    case 'unsigned16': {
      const val = v16 * scaling;
      return {
        display: scaling === 1 ? val.toString() : val.toFixed(2),
        hex: hex16,
      };
    }

    case 'signed16': {
      // Convert to signed 16-bit
      const s16 = v16 > 32767 ? v16 - 65536 : v16;
      const val = s16 * scaling;
      return {
        display: scaling === 1 ? val.toString() : val.toFixed(2),
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
      // Format as 0000 0000 0000 0000
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
      // Float32 needs 2 registers (4 bytes)
      const high = v16;
      const low = values[index + 1] ?? 0;

      const buffer = new ArrayBuffer(4);
      const u8 = new Uint8Array(buffer);
      const h_hi = (high >> 8) & 0xff;
      const h_lo = high & 0xff;
      const l_hi = (low >> 8) & 0xff;
      const l_lo = low & 0xff;

      if (format === 'float_abcd') {
        // Big Endian
        u8[0] = h_hi;
        u8[1] = h_lo;
        u8[2] = l_hi;
        u8[3] = l_lo;
      } else if (format === 'float_cdab') {
        // Little Endian word swap
        u8[0] = l_hi;
        u8[1] = l_lo;
        u8[2] = h_hi;
        u8[3] = h_lo;
      } else if (format === 'float_badc') {
        // Byte swap
        u8[0] = h_lo;
        u8[1] = h_hi;
        u8[2] = l_lo;
        u8[3] = l_hi;
      } else if (format === 'float_dcba') {
        // Little Endian byte & word swap
        u8[0] = l_lo;
        u8[1] = l_hi;
        u8[2] = h_lo;
        u8[3] = h_hi;
      }

      const view = new DataView(buffer);
      const f32 = view.getFloat32(0, false);
      const combinedHex = `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`;

      if (isNaN(f32)) {
        return { display: 'NaN', hex: combinedHex };
      }
      const val = f32 * scaling;
      return {
        display: val.toFixed(4).replace(/\.?0+$/, ''),
        hex: combinedHex,
      };
    }

    case 'long_abcd':
    case 'long_cdab': {
      const high = v16;
      const low = values[index + 1] ?? 0;
      let int32 = 0;
      if (format === 'long_abcd') {
        int32 = (high << 16) | low;
      } else {
        int32 = (low << 16) | high;
      }
      // Signed 32-bit
      int32 = int32 | 0;
      const val = int32 * scaling;
      return {
        display: scaling === 1 ? val.toString() : val.toFixed(2),
        hex: `${hex16} 0x${low.toString(16).toUpperCase().padStart(4, '0')}`,
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
 * Standard Modbus register address display string:
 * FC 01: 00001 + offset
 * FC 02: 10001 + offset
 * FC 03: 40001 + offset
 * FC 04: 30001 + offset
 */
export function getModbusAddressLabel(functionCode: number, address: number): string {
  switch (functionCode) {
    case 1:
      return `${(1 + address).toString().padStart(5, '0')}`;
    case 2:
      return `${(10001 + address).toString()}`;
    case 3:
      return `${(40001 + address).toString()}`;
    case 4:
      return `${(30001 + address).toString()}`;
    default:
      return `${address}`;
  }
}
