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

// FC16 must be rejected as a whole when it would run past address 65535 (the simulator used to
// wrap the second word to address 0).
func TestWriteRegistersRejectsRangePast65535(t *testing.T) {
	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Port: "simulator"}); err != nil {
		t.Fatal(err)
	}
	m.simRegisters[0] = 2205
	if err := m.WriteRegisters(WriteRegistersParam{SlaveID: 1, Address: 65535, Values: []uint16{1, 2}}); err == nil {
		t.Fatal("expected an error for 65535 + 2 words")
	}
	if m.simRegisters[0] != 2205 || m.simRegisters[65535] != 0 {
		t.Fatalf("nothing may be written: reg0=%d reg65535=%d", m.simRegisters[0], m.simRegisters[65535])
	}
	if err := m.WriteRegisters(WriteRegistersParam{SlaveID: 1, Address: 65534, Values: []uint16{1, 2}}); err != nil {
		t.Fatalf("65534 + 2 words ends at 65535 and is valid: %v", err)
	}
	if err := m.WriteRegisters(WriteRegistersParam{SlaveID: 1, Address: 0, Values: make([]uint16, 124)}); err == nil {
		t.Fatal("expected an error for 124 words")
	}
}
