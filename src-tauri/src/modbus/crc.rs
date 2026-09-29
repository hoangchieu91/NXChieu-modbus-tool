pub fn calculate_crc16(buf: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in buf {
        crc ^= byte as u16;
        for _ in 0..8 {
            if (crc & 0x0001) != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

pub fn format_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<String>>()
        .join(" ")
}

pub fn build_rtu_read_request(slave_id: u8, fc: u8, addr: u16, qty: u16) -> Vec<u8> {
    let mut frame = vec![
        slave_id,
        fc,
        (addr >> 8) as u8,
        addr as u8,
        (qty >> 8) as u8,
        qty as u8,
    ];
    let crc = calculate_crc16(&frame);
    frame.push(crc as u8); // Lo byte first
    frame.push((crc >> 8) as u8); // Hi byte
    frame
}

pub fn build_rtu_register_response(slave_id: u8, fc: u8, values: &[u16]) -> Vec<u8> {
    let byte_count = (values.len() * 2) as u8;
    let mut frame = vec![slave_id, fc, byte_count];
    for &v in values {
        frame.push((v >> 8) as u8);
        frame.push(v as u8);
    }
    let crc = calculate_crc16(&frame);
    frame.push(crc as u8);
    frame.push((crc >> 8) as u8);
    frame
}

pub fn build_rtu_coil_response(slave_id: u8, fc: u8, bits: &[bool]) -> Vec<u8> {
    let byte_count = ((bits.len() + 7) / 8) as u8;
    let mut frame = vec![slave_id, fc, byte_count];
    for chunk in bits.chunks(8) {
        let mut byte: u8 = 0;
        for (i, &bit) in chunk.iter().enumerate() {
            if bit {
                byte |= 1 << i;
            }
        }
        frame.push(byte);
    }
    let crc = calculate_crc16(&frame);
    frame.push(crc as u8);
    frame.push((crc >> 8) as u8);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc16_standard() {
        // Standard Modbus test vector:
        // [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A] -> CRC 0xC5CD (Lo: 0xCD, Hi: 0xC5 in little-endian order)
        let frame = build_rtu_read_request(1, 3, 0, 10);
        assert_eq!(frame, vec![0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD]);
        assert_eq!(format_hex(&frame), "01 03 00 00 00 0A C5 CD");
    }
}
