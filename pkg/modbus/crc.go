package modbus

import (
	"encoding/binary"
	"fmt"
	"strings"
)

// CRC16Modbus calculates the standard Modbus RTU CRC16 checksum.
func CRC16Modbus(data []byte) uint16 {
	var crc uint16 = 0xFFFF
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if (crc & 0x0001) != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

// FormatHex formats a byte slice into an uppercase space-separated hex string, e.g. "01 03 00 00 C5 CD".
func FormatHex(data []byte) string {
	hexParts := make([]string, len(data))
	for i, b := range data {
		hexParts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(hexParts, " ")
}

// BuildRTUReadRequest builds the complete raw Modbus RTU request frame including CRC16.
func BuildRTUReadRequest(slaveID uint8, functionCode uint8, startAddress uint16, quantity uint16) []byte {
	buf := make([]byte, 6, 8)
	buf[0] = slaveID
	buf[1] = functionCode
	binary.BigEndian.PutUint16(buf[2:4], startAddress)
	binary.BigEndian.PutUint16(buf[4:6], quantity)

	crc := CRC16Modbus(buf)
	crcBytes := make([]byte, 2)
	binary.LittleEndian.PutUint16(crcBytes, crc)

	return append(buf, crcBytes...)
}

// BuildRTURegisterResponse builds a raw RTU response frame for holding/input registers (FC 03 / 04).
func BuildRTURegisterResponse(slaveID uint8, functionCode uint8, registers []uint16) []byte {
	byteCount := uint8(len(registers) * 2)
	frame := make([]byte, 3+int(byteCount))
	frame[0] = slaveID
	frame[1] = functionCode
	frame[2] = byteCount

	offset := 3
	for _, reg := range registers {
		binary.BigEndian.PutUint16(frame[offset:offset+2], reg)
		offset += 2
	}

	crc := CRC16Modbus(frame)
	crcBytes := make([]byte, 2)
	binary.LittleEndian.PutUint16(crcBytes, crc)

	return append(frame, crcBytes...)
}

// BuildRTUCoilResponse builds a raw RTU response frame for coils/discrete inputs (FC 01 / 02).
func BuildRTUCoilResponse(slaveID uint8, functionCode uint8, coils []bool) []byte {
	byteCount := uint8((len(coils) + 7) / 8)
	dataBytes := make([]byte, byteCount)

	for i, bit := range coils {
		if bit {
			byteIdx := i / 8
			bitIdx := i % 8
			dataBytes[byteIdx] |= 1 << bitIdx
		}
	}

	frame := make([]byte, 3+int(byteCount))
	frame[0] = slaveID
	frame[1] = functionCode
	frame[2] = byteCount
	copy(frame[3:], dataBytes)

	crc := CRC16Modbus(frame)
	crcBytes := make([]byte, 2)
	binary.LittleEndian.PutUint16(crcBytes, crc)

	return append(frame, crcBytes...)
}

// BuildRTUExceptionResponse builds an RTU exception frame: unit, FC|0x80, code, CRC.
func BuildRTUExceptionResponse(slaveID uint8, functionCode uint8, exceptionCode byte) []byte {
	frame := []byte{slaveID, functionCode | 0x80, exceptionCode}
	return binary.LittleEndian.AppendUint16(frame, CRC16Modbus(frame))
}
