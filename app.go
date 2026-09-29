package main

import (
	"context"
	"sync"

	"nxchieu-modbus-tool/pkg/modbus"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct manages application state and bridges Wails frontend calls.
type App struct {
	ctx      context.Context
	mu       sync.Mutex
	sessMgr  *modbus.SessionManager
	defPort  *modbus.ModbusClientWrapper
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{
		defPort: modbus.NewModbusClientWrapper(),
	}

	app.sessMgr = modbus.NewSessionManager(
		func(sessionID string, res modbus.PollResult) {
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, "poll-data", res)
			}
		},
		func(act modbus.SlaveActivityEvent) {
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, "slave-activity", act)
			}
		},
	)

	return app
}

// startup is called when the app starts. The context is saved so we can emit events.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ListSerialPorts returns available COM ports on the system.
func (a *App) ListSerialPorts() []modbus.SerialPortDetail {
	return a.defPort.ListSerialPorts()
}

// CloseSession closes and frees resources associated with a tab session.
func (a *App) CloseSession(sessionID string) {
	a.sessMgr.CloseSession(sessionID)
}

// --- Session-Aware Master Operations ---

// SessionConnect connects a tab session's Master client to Serial, TCP, RTU over TCP, or Simulator.
func (a *App) SessionConnect(sessionID string, config modbus.ConnectionConfig) (string, error) {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterConnect(sessionID, config)
}

// SessionDisconnect disconnects a tab session's Master client.
func (a *App) SessionDisconnect(sessionID string) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.MasterDisconnect(sessionID)
}

// SessionStartPolling begins polling on a session.
func (a *App) SessionStartPolling(sessionID string, def modbus.PollDefinition) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterStartPolling(sessionID, def)
}

// SessionStopPolling pauses polling on a session.
func (a *App) SessionStopPolling(sessionID string) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.MasterStopPolling(sessionID)
}

// SessionReadOnce executes a single read on a session.
func (a *App) SessionReadOnce(sessionID string, def modbus.PollDefinition) modbus.PollResult {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterReadOnce(sessionID, def)
}

// SessionWriteRegister writes a 16-bit register on a session.
func (a *App) SessionWriteRegister(sessionID string, param modbus.WriteRegisterParam) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterWriteRegister(sessionID, param)
}

// SessionWriteCoil writes a single coil on a session.
func (a *App) SessionWriteCoil(sessionID string, param modbus.WriteCoilParam) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterWriteCoil(sessionID, param)
}

// SessionGetConnectionStatus returns true if session master is connected.
func (a *App) SessionGetConnectionStatus(sessionID string) bool {
	if sessionID == "" {
		sessionID = "default"
	}
	sess := a.sessMgr.GetOrCreateSession(sessionID, modbus.RoleMaster)
	return sess.Master.IsConnected()
}

// --- Modbus Slave (Server Simulator) Operations ---

// SlaveStart launches the Modbus Slave server for a session.
func (a *App) SlaveStart(sessionID string, config modbus.SlaveConfig) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.SlaveStart(sessionID, config)
}

// SlaveStop stops the Modbus Slave server for a session.
func (a *App) SlaveStop(sessionID string) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.SlaveStop(sessionID)
}

// SlaveIsListening returns true if slave server is active.
func (a *App) SlaveIsListening(sessionID string) bool {
	if sessionID == "" {
		sessionID = "default"
	}
	sess := a.sessMgr.GetOrCreateSession(sessionID, modbus.RoleSlave)
	return sess.Slave.IsListening()
}

// SlaveGetSlice reads memory registers or coils from a slave session to render on the UI.
func (a *App) SlaveGetSlice(sessionID string, table string, startAddr uint16, qty uint16) modbus.SlaveMemorySlice {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.SlaveGetSlice(sessionID, table, startAddr, qty)
}

// SlaveSetRegister modifies a holding or input register in the slave memory table.
func (a *App) SlaveSetRegister(sessionID string, table string, addr uint16, val uint16) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.SlaveSetRegister(sessionID, table, addr, val)
}

// SlaveSetCoil modifies a coil or discrete input in the slave memory table.
func (a *App) SlaveSetCoil(sessionID string, table string, addr uint16, val bool) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.SlaveSetCoil(sessionID, table, addr, val)
}

// SlaveStartSim triggers background automated value fluctuation.
func (a *App) SlaveStartSim(sessionID string, config modbus.SimulationConfig) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.SlaveStartSimulation(sessionID, config)
}

// SlaveStopSim halts background simulation.
func (a *App) SlaveStopSim(sessionID string) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.SlaveStopSimulation(sessionID)
}

// --- Backward Compatibility Single-Session Methods ---

// Connect connects default master.
func (a *App) Connect(config modbus.ConnectionConfig) (string, error) {
	return a.SessionConnect("default", config)
}

// Disconnect disconnects default master.
func (a *App) Disconnect() {
	a.SessionDisconnect("default")
}

// GetConnectionStatus returns status for default master.
func (a *App) GetConnectionStatus() bool {
	return a.SessionGetConnectionStatus("default")
}

// StartPolling starts polling on default master.
func (a *App) StartPolling(def modbus.PollDefinition) error {
	return a.SessionStartPolling("default", def)
}

// StopPolling stops polling on default master.
func (a *App) StopPolling() {
	a.SessionStopPolling("default")
}

// ReadOnce reads once on default master.
func (a *App) ReadOnce(def modbus.PollDefinition) modbus.PollResult {
	return a.SessionReadOnce("default", def)
}

// WriteSingleRegister writes on default master.
func (a *App) WriteSingleRegister(param modbus.WriteRegisterParam) error {
	return a.SessionWriteRegister("default", param)
}

// WriteSingleCoil writes on default master.
func (a *App) WriteSingleCoil(param modbus.WriteCoilParam) error {
	return a.SessionWriteCoil("default", param)
}
