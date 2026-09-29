package modbus

import (
	"testing"
)

func TestScannerSimulator(t *testing.T) {
	wrapper := NewModbusClientWrapper()

	// Connect to simulator
	cfg := ConnectionConfig{
		Type:      "serial",
		Port:      "simulator",
		TimeoutMs: 100,
	}
	_, err := wrapper.Connect(cfg)
	if err != nil {
		t.Fatalf("Failed to connect to simulator: %v", err)
	}

	// 1. Test Slave ID Probing
	item1 := wrapper.ProbeSlave(1, 100)
	if item1.Status != "online" {
		t.Errorf("Expected slave 1 to be online, got: %s", item1.Status)
	}

	item99 := wrapper.ProbeSlave(99, 100)
	if item99.Status != "offline" {
		t.Errorf("Expected slave 99 to be offline, got: %s", item99.Status)
	}

	// 2. Test ScanSlaveRange
	rangeResults := wrapper.ScanSlaveRange(1, 5, 100)
	if len(rangeResults) != 5 {
		t.Errorf("Expected 5 results, got %d", len(rangeResults))
	}

	// 3. Test ScanRegisters
	regResults := wrapper.ScanRegisters(1, 3, 0, 10)
	if len(regResults) != 11 {
		t.Errorf("Expected 11 registers (0..10), got %d", len(regResults))
	}
	if !regResults[0].Valid || regResults[0].Value != 2205 {
		t.Errorf("Expected Reg 0 = 2205, got %v (%d)", regResults[0].Valid, regResults[0].Value)
	}

	// 4. Test AutoDetectBaudrate with simulator
	baudResults := AutoDetectBaudrate("simulator", 1, []uint{9600, 19200}, []string{"none", "even"})
	hasSuccess := false
	for _, r := range baudResults {
		if r.Success {
			hasSuccess = true
			if r.BaudRate != 9600 || r.Parity != "none" {
				t.Errorf("Unexpected matched baud: %v", r)
			}
			break
		}
	}
	if !hasSuccess {
		t.Errorf("Expected simulator to match 9600 None")
	}
}
