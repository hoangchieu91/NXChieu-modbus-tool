package modbus

import (
	"testing"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
)

// A TCP slave that restarts (device reboot, gateway power cycle) must not leave the master
// failing forever: the master reopens the socket on its own.
func TestMasterReconnectsAfterTCPSlaveRestart(t *testing.T) {
	const port = 5512
	cfg := SlaveConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, SlaveID: 1}

	slave := NewModbusSlaveServer("reconnect-slave", nil)
	if err := slave.Start(cfg); err != nil {
		t.Fatalf("start slave: %v", err)
	}
	defer slave.Stop()
	time.Sleep(100 * time.Millisecond)

	master := NewModbusClientWrapper()
	if _, err := master.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 500}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer master.Disconnect()

	def := PollDefinition{SlaveID: 1, FunctionCode: 3, StartAddress: 0, Quantity: 2}
	if res := master.ExecuteRead(def); res.Error != "" {
		t.Fatalf("initial read failed: %s", res.Error)
	}

	// Drop the connection from the slave side.
	slave.Stop()
	time.Sleep(100 * time.Millisecond)
	if res := master.ExecuteRead(def); res.Error == "" {
		t.Fatal("read should fail while the slave is down")
	}

	if err := slave.Start(cfg); err != nil {
		t.Fatalf("restart slave: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	deadline := time.Now().Add(5 * time.Second)
	for {
		res := master.ExecuteRead(def)
		if res.Error == "" {
			if len(res.Values) != 2 || res.Values[0] != 2205 {
				t.Fatalf("unexpected values after reconnect: %v", res.Values)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("master did not reconnect, last error: %s", res.Error)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// Only timeouts in a row mean a dead TCP link; any answer in between (even an exception) resets
// the count.
func TestTCPTimeoutCountResetsOnAnswer(t *testing.T) {
	m := NewModbusClientWrapper()
	m.activeConfig = &ConnectionConfig{Type: "tcp"}

	for _, err := range []error{
		simonmodbus.ErrRequestTimedOut, simonmodbus.ErrRequestTimedOut,
		simonmodbus.ErrIllegalDataAddress, // device answered
		simonmodbus.ErrRequestTimedOut,
	} {
		m.noteResultLocked(err)
	}
	if m.needsReopen {
		t.Fatal("timeout, timeout, exception, timeout must not trigger a reconnect")
	}

	m.noteResultLocked(simonmodbus.ErrRequestTimedOut)
	m.noteResultLocked(simonmodbus.ErrRequestTimedOut)
	if !m.needsReopen {
		t.Fatal("three consecutive timeouts must trigger a reconnect")
	}
}
