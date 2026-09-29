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
	wrapper := NewModbusClientWrapper()
	// Test formatted Windows port
	p1 := wrapper.formatPortName("COM49")
	if p1 != `\\.\COM49` {
		t.Fatalf("Expected '\\\\.\\COM49', got %s", p1)
	}
	p2 := wrapper.formatPortName(`\\.\COM49`)
	if p2 != `\\.\COM49` {
		t.Fatalf("Expected '\\\\.\\COM49', got %s", p2)
	}
	p3 := wrapper.formatPortName("COM1")
	if p3 != `\\.\COM1` {
		t.Fatalf("Expected '\\\\.\\COM1', got %s", p3)
	}
}
