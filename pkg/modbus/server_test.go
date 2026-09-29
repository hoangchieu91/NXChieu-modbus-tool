package modbus

import (
	"testing"
	"time"
)

func TestSlaveMemoryStore(t *testing.T) {
	var activityRecorded bool
	store := NewSlaveMemoryStore("test-sess", 1, func(act SlaveActivityEvent) {
		activityRecorded = true
	})

	// Test default telemetry values
	if store.HoldingRegisters[0] != 2205 {
		t.Fatalf("expected HoldingRegister[0] to be 2205, got %d", store.HoldingRegisters[0])
	}
	if store.InputRegisters[0] != 2400 {
		t.Fatalf("expected InputRegister[0] to be 2400, got %d", store.InputRegisters[0])
	}
	if !store.Coils[0] {
		t.Fatalf("expected Coil[0] to be true")
	}

	// Test GetSlice
	slice := store.GetSlice("holding", 0, 5)
	if len(slice.Values) != 5 || slice.Values[0] != 2205 {
		t.Fatalf("unexpected slice output: %+v", slice)
	}

	// Test SetRegister & SetCoil
	store.SetRegister("holding", 10, 12345)
	if store.HoldingRegisters[10] != 12345 {
		t.Fatalf("expected HoldingRegister[10] to be 12345")
	}

	store.SetCoil("coils", 15, true)
	if !store.Coils[15] {
		t.Fatalf("expected Coil[15] to be true")
	}
	_ = activityRecorded
}

func TestMasterSlaveLoopbackTCP(t *testing.T) {
	// 1. Initialize Slave Server on port 5502
	var slaveActivityList []SlaveActivityEvent
	slave := NewModbusSlaveServer("session-slave", func(act SlaveActivityEvent) {
		slaveActivityList = append(slaveActivityList, act)
	})

	slaveConfig := SlaveConfig{
		Type:    "tcp",
		Host:    "127.0.0.1",
		TcpPort: 5502,
		SlaveID: 1,
	}

	if err := slave.Start(slaveConfig); err != nil {
		t.Fatalf("failed to start slave server: %v", err)
	}
	defer slave.Stop()

	if !slave.IsListening() {
		t.Fatalf("expected slave server to be listening")
	}

	// Brief pause to allow listener to bind
	time.Sleep(100 * time.Millisecond)

	// 2. Initialize Master Client and connect to 127.0.0.1:5502
	client := NewModbusClientWrapper()
	msg, err := client.Connect(ConnectionConfig{
		Type:      "tcp",
		Host:      "127.0.0.1",
		TcpPort:   5502,
		TimeoutMs: 2000,
	})
	if err != nil {
		t.Fatalf("failed to connect master client: %v", err)
	}
	defer client.Disconnect()
	t.Logf("Master connected: %s", msg)

	// 3. Write Holding Register 0 to 9999
	err = client.WriteRegister(WriteRegisterParam{
		SlaveID: 1,
		Address: 0,
		Value:   9999,
	})
	if err != nil {
		t.Fatalf("master failed to write register: %v", err)
	}

	// 4. Read back Holding Register 0
	readRes := client.ExecuteRead(PollDefinition{
		SlaveID:      1,
		FunctionCode: 3, // Holding Registers
		StartAddress: 0,
		Quantity:     1,
		ScanRateMs:   1000,
	})
	if readRes.Error != "" {
		t.Fatalf("master read error: %s", readRes.Error)
	}
	if len(readRes.Values) == 0 || readRes.Values[0] != 9999 {
		t.Fatalf("expected register 0 to be 9999, got: %+v", readRes.Values)
	}

	// 5. Write Coil 2 to false
	err = client.WriteCoil(WriteCoilParam{
		SlaveID: 1,
		Address: 2,
		Value:   false,
	})
	if err != nil {
		t.Fatalf("master failed to write coil: %v", err)
	}

	// 6. Read back Coil 2
	readCoilRes := client.ExecuteRead(PollDefinition{
		SlaveID:      1,
		FunctionCode: 1, // Coils
		StartAddress: 2,
		Quantity:     1,
		ScanRateMs:   1000,
	})
	if readCoilRes.Error != "" {
		t.Fatalf("master read coil error: %s", readCoilRes.Error)
	}
	if len(readCoilRes.BoolValues) == 0 || readCoilRes.BoolValues[0] != false {
		t.Fatalf("expected coil 2 to be false, got: %+v", readCoilRes.BoolValues)
	}

	t.Log("Master-Slave TCP Loopback Test PASSED successfully!")
}
