package modbus

import (
	"testing"
	"time"
)

// Absent IDs on a TCP gateway time out one after another. That must not trip the dead-link
// detector, which used to skip every following ID and report it offline without probing.
func TestSlaveScanProbesEveryIDOnTCP(t *testing.T) {
	port := silentDevice(t)
	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 1000}); err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect()

	for _, r := range m.ScanSlaveRange(1, 10, 50) {
		if r.Status != "offline" || r.LatencyMs < 40 {
			t.Fatalf("ID %d not really probed: status=%q latency=%dms detail=%q", r.SlaveID, r.Status, r.LatencyMs, r.Detail)
		}
	}
}

// The TCP slave must not claim every unit ID: other IDs get a gateway "no target" answer, which
// the scanner reports as offline, like the RTU path's silence.
func TestTCPSlaveOnlyAnswersItsUnitID(t *testing.T) {
	const port = 5532
	slave := NewModbusSlaveServer("unit", nil)
	if err := slave.Start(SlaveConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, SlaveID: 1}); err != nil {
		t.Fatal(err)
	}
	defer slave.Stop()
	time.Sleep(100 * time.Millisecond)

	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 500}); err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect()

	want := map[uint8]string{1: "online", 2: "offline", 5: "offline", 255: "online"}
	for id, status := range want {
		if got := m.ProbeSlave(id, 0); got.Status != status {
			t.Fatalf("unit %d: got %q (%s), want %q", id, got.Status, got.Detail, status)
		}
	}
}

// A register scan of a device that never answers must not retry each of the 125 registers of a
// block with the full timeout (that used to take minutes).
func TestRegisterScanOfSilentDeviceIsBounded(t *testing.T) {
	port := silentDevice(t)
	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 50}); err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect()

	start := time.Now()
	res := m.ScanRegisters(1, 3, 0, 299)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("scan of 300 registers took %v", elapsed)
	}
	if len(res) != 300 || res[0].Valid || res[299].Valid {
		t.Fatalf("expected 300 invalid results, got %d", len(res))
	}
}

// Restarting the slave (e.g. to change the port) must not silently stop a running simulation.
func TestSimulationSurvivesSlaveRestart(t *testing.T) {
	slave := NewModbusSlaveServer("sim", nil)
	cfg := SlaveConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: 5533, SlaveID: 1}
	if err := slave.Start(cfg); err != nil {
		t.Fatal(err)
	}
	defer slave.Stop()
	slave.StartSimulation(SimulationConfig{Table: "holding", Address: 50, Mode: "increment", Step: 1, IntervalMs: 100})

	cfg.TcpPort = 5534
	if err := slave.Start(cfg); err != nil {
		t.Fatal(err)
	}
	before := slave.GetMemoryStore().GetSlice("holding", 50, 1).Values[0]
	time.Sleep(350 * time.Millisecond)
	if after := slave.GetMemoryStore().GetSlice("holding", 50, 1).Values[0]; after == before {
		t.Fatalf("simulation stopped after restart (value stuck at %d)", after)
	}
}
