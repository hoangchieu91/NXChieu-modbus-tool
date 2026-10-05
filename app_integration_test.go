package main

import (
	"testing"
	"time"

	"nxchieu-modbus-tool/pkg/modbus"
)

// This follows the same App methods used by the Wails frontend. It catches regressions where
// the UI still renders but connect/read/write/polling or slave memory no longer reaches the core.
func TestDesktopBridgeWorkflowWithSimulator(t *testing.T) {
	app := NewApp()
	const sessionID = "ui-smoke-master"
	defer app.CloseSession(sessionID)

	_, err := app.SessionConnect(sessionID, modbus.ConnectionConfig{
		Type: "serial", Port: "simulator", BaudRate: 9600, DataBits: 8,
		Parity: "none", StopBits: 1, TimeoutMs: 1000,
	})
	if err != nil {
		t.Fatalf("connect simulator through App bridge: %v", err)
	}
	if !app.SessionGetConnectionStatus(sessionID) {
		t.Fatal("App bridge reports disconnected after a successful connect")
	}

	def := modbus.PollDefinition{SlaveID: 1, FunctionCode: 3, StartAddress: 0, Quantity: 4, ScanRateMs: 50}
	first := app.SessionReadOnce(sessionID, def)
	if first.Error != "" || len(first.Values) != 4 || first.RawTx == "" || first.RawRx == "" {
		t.Fatalf("read once returned an unusable result: %+v", first)
	}
	if snapshot := app.GetSnifferSnapshot(10); len(snapshot.Frames) < 2 {
		t.Fatal("Read Once did not reach the shared analyzer pipeline")
	}

	if err := app.SessionWriteRegister(sessionID, modbus.WriteRegisterParam{SlaveID: 1, Address: 0, Value: 4321}); err != nil {
		t.Fatalf("write register through App bridge: %v", err)
	}
	second := app.SessionReadOnce(sessionID, def)
	if second.Error != "" || len(second.Values) == 0 || second.Values[0] != 4321 {
		t.Fatalf("written value did not round-trip: %+v", second)
	}

	if err := app.SessionStartPolling(sessionID, def); err != nil {
		t.Fatalf("start polling through App bridge: %v", err)
	}
	time.Sleep(130 * time.Millisecond)
	app.SessionStopPolling(sessionID)
	if snapshot := app.GetSnifferSnapshot(100); len(snapshot.Frames) == 0 {
		t.Fatal("poll results did not reach the shared analyzer pipeline")
	}

	app.SessionDisconnect(sessionID)
	if app.SessionGetConnectionStatus(sessionID) {
		t.Fatal("App bridge reports connected after disconnect")
	}
}

func TestDesktopBridgeSlaveMemoryWorkflow(t *testing.T) {
	app := NewApp()
	const sessionID = "ui-smoke-slave"
	defer app.CloseSession(sessionID)

	app.SlaveSetRegister(sessionID, "holding", 7, 2468)
	registers := app.SlaveGetSlice(sessionID, "holding", 7, 1)
	if len(registers.Values) != 1 || registers.Values[0] != 2468 {
		t.Fatalf("slave holding register did not round-trip: %+v", registers)
	}

	app.SlaveSetCoil(sessionID, "coils", 3, true)
	coils := app.SlaveGetSlice(sessionID, "coils", 3, 1)
	if len(coils.BoolValues) != 1 || !coils.BoolValues[0] {
		t.Fatalf("slave coil did not round-trip: %+v", coils)
	}
}

func TestDesktopBridgeScannerWorkflow(t *testing.T) {
	app := NewApp()
	const sessionID = "ui-smoke-scanner"
	defer app.CloseSession(sessionID)

	if _, err := app.SessionConnect(sessionID, modbus.ConnectionConfig{Type: "serial", Port: "simulator", TimeoutMs: 100}); err != nil {
		t.Fatal(err)
	}
	devices := app.ScanSlaveIDs(sessionID, 1, 3, 50)
	if len(devices) != 3 || devices[0].Status != "online" {
		t.Fatalf("scanner did not find simulator Unit 1: %+v", devices)
	}
	registers := app.ScanRegisters(sessionID, 3, 0, 4)
	if len(registers) != 5 || !registers[0].Valid {
		t.Fatalf("register scanner returned unusable data: %+v", registers)
	}
	baud := app.AutoDetectBaudrate("simulator", 1, []uint{9600}, []string{"none"})
	if len(baud) != 1 || !baud[0].Success {
		t.Fatalf("baud scanner did not recognize simulator: %+v", baud)
	}
}

func TestDesktopBridgeSlaveSimulationWorkflow(t *testing.T) {
	app := NewApp()
	const sessionID = "ui-smoke-slave-simulation"
	defer app.CloseSession(sessionID)

	app.SlaveSetRegister(sessionID, "holding", 50, 100)
	app.SlaveStartSim(sessionID, modbus.SimulationConfig{
		SessionID: sessionID, Table: "holding", Address: 50, Mode: "increment",
		Min: 0, Max: 1000, Step: 2, IntervalMs: 50,
	})
	time.Sleep(130 * time.Millisecond)
	app.SlaveStopSim(sessionID)
	values := app.SlaveGetSlice(sessionID, "holding", 50, 1).Values
	if len(values) != 1 || values[0] == 100 {
		t.Fatalf("slave simulation did not update its register: %+v", values)
	}
}

// Self-test traffic must not enter the user's analyzer (baseline, health, reports, captures).
func TestDiagnosticSessionTrafficIsIsolated(t *testing.T) {
	app := NewApp()
	res := modbus.PollResult{RawTx: "01 03 00 00 00 02 C4 0B", RawRx: "01 03 04 00 01 00 02 2A 32", LatencyMs: 5}
	app.ingestPollResult(diagnosticSessionPrefix+"master_1", res)
	if n := len(app.GetSnifferSnapshot(10).Frames); n != 0 {
		t.Fatalf("self-test frames leaked into the main analyzer: %d", n)
	}
	if n := len(app.GetDiagnosticSnifferSnapshot(10).Frames); n != 2 {
		t.Fatalf("diagnostic analyzer has %d frames, want 2", n)
	}
	app.ingestPollResult("tab-1", res)
	if n := len(app.GetSnifferSnapshot(10).Frames); n != 2 {
		t.Fatalf("normal session traffic missing from the main analyzer: %d", n)
	}
}
