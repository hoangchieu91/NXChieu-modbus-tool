package modbus

import (
	"bytes"
	"testing"
)

func TestCRC16Modbus(t *testing.T) {
	// Standard Modbus request: Slave 1, FC 3, Addr 0, Qty 10
	req := BuildRTUReadRequest(1, 3, 0, 10)
	expected := []byte{0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD}

	if !bytes.Equal(req, expected) {
		t.Fatalf("Expected %X, got %X", expected, req)
	}

	hexStr := FormatHex(req)
	if hexStr != "01 03 00 00 00 0A C5 CD" {
		t.Fatalf("Expected '01 03 00 00 00 0A C5 CD', got '%s'", hexStr)
	}
}

func TestSerialPortFormat(t *testing.T) {
	// Test formatted Windows port
	p1 := normalizeSerialPort("COM49")
	if p1 != `\\.\COM49` {
		t.Fatalf("Expected '\\\\.\\COM49', got %s", p1)
	}
	p2 := normalizeSerialPort(`\\.\COM49`)
	if p2 != `\\.\COM49` {
		t.Fatalf("Expected '\\\\.\\COM49', got %s", p2)
	}
	p3 := normalizeSerialPort("COM1")
	if p3 != `\\.\COM1` {
		t.Fatalf("Expected '\\\\.\\COM1', got %s", p3)
	}
	// Test Linux/Ubuntu & Router serial port formats
	p4 := normalizeSerialPort("/dev/ttyUSB0 (FTDI USB-RS485)")
	if p4 != "/dev/ttyUSB0" {
		t.Fatalf("Expected '/dev/ttyUSB0', got %s", p4)
	}
	p5 := normalizeSerialPort("/dev/ttyCH0")
	if p5 != "/dev/ttyCH0" {
		t.Fatalf("Expected '/dev/ttyCH0', got %s", p5)
	}
}

func TestBuildSubBlocksSkipsDisabledAddrs(t *testing.T) {
	def := PollDefinition{
		SlaveID:       1,
		FunctionCode:  3,
		StartAddress:  2,
		Quantity:      15,
		DisabledAddrs: []uint16{3, 4, 5, 8, 9, 10, 12},
	}
	blocks := def.BuildSubBlocks()
	// Expected contiguous blocks inside [2..16] excluding {3,4,5, 8,9,10, 12}:
	// [2..2] (quantity 1, offset 0)
	// [6..7] (quantity 2, offset 4)
	// [11..11] (quantity 1, offset 9)
	// [13..16] (quantity 4, offset 11)
	if len(blocks) != 4 {
		t.Fatalf("Expected 4 sub-blocks, got %d: %+v", len(blocks), blocks)
	}
	if blocks[0].StartAddress != 2 || blocks[0].Quantity != 1 || blocks[0].Offset != 0 {
		t.Fatalf("Unexpected block[0]: %+v", blocks[0])
	}
	if blocks[1].StartAddress != 6 || blocks[1].Quantity != 2 || blocks[1].Offset != 4 {
		t.Fatalf("Unexpected block[1]: %+v", blocks[1])
	}
	if blocks[2].StartAddress != 11 || blocks[2].Quantity != 1 || blocks[2].Offset != 9 {
		t.Fatalf("Unexpected block[2]: %+v", blocks[2])
	}
	if blocks[3].StartAddress != 13 || blocks[3].Quantity != 4 || blocks[3].Offset != 11 {
		t.Fatalf("Unexpected block[3]: %+v", blocks[3])
	}
}
