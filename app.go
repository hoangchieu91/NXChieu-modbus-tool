package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"nxchieu-modbus-tool/pkg/modbus"
	"nxchieu-modbus-tool/pkg/web"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct manages application state and bridges Wails frontend calls.
type App struct {
	ctx          context.Context
	mu           sync.Mutex
	sessMgr      *modbus.SessionManager
	defPort      *modbus.ModbusClientWrapper
	remoteServer *web.RemoteServer

	pendingWrites map[string]chan string // remote writes awaiting the desktop UI, by request id
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{
		defPort: modbus.NewModbusClientWrapper(),
	}

	app.remoteServer = web.NewRemoteServer(
		app.handleRemoteWrite,
		func() map[string]interface{} {
			return map[string]interface{}{
				"timestamp": time.Now().Format(time.RFC3339),
			}
		},
	)

	app.sessMgr = modbus.NewSessionManager(
		func(sessionID string, res modbus.PollResult) {
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, "poll-data", res)
			}
			if app.remoteServer != nil {
				app.remoteServer.BroadcastPollResult(sessionID, res)
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

// remoteWriteTimeout bounds how long a phone waits for the desktop UI to perform a write.
const remoteWriteTimeout = 10 * time.Second

// handleRemoteWrite forwards a phone write to the desktop UI, which encodes the typed value with
// the row's format and scaling and applies the same checks as an inline write (read-only
// tables, ranges, FC06/FC16, Slave ID). Writing raw values from here would bypass all of that.
func (a *App) handleRemoteWrite(req web.RemoteWriteRequest) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop UI not ready")
	}
	if req.Address == nil {
		return fmt.Errorf("address is required")
	}

	id := fmt.Sprintf("rw-%d", time.Now().UnixNano())
	done := make(chan string, 1)
	a.mu.Lock()
	if a.pendingWrites == nil {
		a.pendingWrites = make(map[string]chan string)
	}
	a.pendingWrites[id] = done
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.pendingWrites, id)
		a.mu.Unlock()
	}()

	text := req.Text
	if text == "" && !req.IsCoil {
		text = fmt.Sprintf("%d", req.Value)
	}
	runtime.EventsEmit(a.ctx, "remote-write", map[string]interface{}{
		"id":         id,
		"tab_id":     req.TabID,
		"address":    *req.Address,
		"is_coil":    req.IsCoil,
		"bool_value": req.BoolValue,
		"text":       text,
	})

	select {
	case errMsg := <-done:
		if errMsg != "" {
			return fmt.Errorf("%s", errMsg)
		}
		return nil
	case <-time.After(remoteWriteTimeout):
		return fmt.Errorf("desktop app did not respond to the write request")
	}
}

// CompleteRemoteWrite is called by the desktop UI when it has handled a "remote-write" event;
// errMsg is empty on success.
func (a *App) CompleteRemoteWrite(id string, errMsg string) {
	a.mu.Lock()
	done := a.pendingWrites[id]
	a.mu.Unlock()
	if done != nil {
		select {
		case done <- errMsg:
		default:
		}
	}
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

// SessionWriteRegisters writes multiple 16-bit registers on a session (FC 16).
func (a *App) SessionWriteRegisters(sessionID string, param modbus.WriteRegistersParam) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterWriteRegisters(sessionID, param)
}

// SessionWriteCoil writes a single coil on a session.
func (a *App) SessionWriteCoil(sessionID string, param modbus.WriteCoilParam) error {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.MasterWriteCoil(sessionID, param)
}

// SessionResetCounters zeroes a session's TX/error counters (the toolbar's Clear counters).
func (a *App) SessionResetCounters(sessionID string) {
	if sessionID == "" {
		sessionID = "default"
	}
	a.sessMgr.MasterResetCounters(sessionID)
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

// WriteRegisters writes multiple registers on default master.
func (a *App) WriteRegisters(param modbus.WriteRegistersParam) error {
	return a.SessionWriteRegisters("default", param)
}

// WriteSingleCoil writes on default master.
func (a *App) WriteSingleCoil(param modbus.WriteCoilParam) error {
	return a.SessionWriteCoil("default", param)
}

// --- Diagnostic & Scanning Tools ---

// ScanSlaveIDs scans a range of slave IDs [startID, endID] on the given session.
func (a *App) ScanSlaveIDs(sessionID string, startID, endID uint8, timeoutMs uint) []modbus.SlaveScanItem {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.ScanSlaveIDs(sessionID, startID, endID, timeoutMs)
}

// AutoDetectBaudrate probes multiple Baudrate & Parity configurations on a COM port.
func (a *App) AutoDetectBaudrate(port string, slaveID uint8, bauds []uint, parities []string) []modbus.BaudScanItem {
	return modbus.AutoDetectBaudrate(port, slaveID, bauds, parities)
}

// ScanRegisters scans a range of register addresses to inspect availability.
func (a *App) ScanRegisters(sessionID string, fc uint8, startAddr, endAddr uint16) []modbus.RegisterScanItem {
	if sessionID == "" {
		sessionID = "default"
	}
	return a.sessMgr.ScanRegisters(sessionID, fc, startAddr, endAddr)
}

// --- Web Remote Server Operations ---

// StartRemoteServer starts the HTTP & WebSocket server for mobile phone live monitoring.
func (a *App) StartRemoteServer(port uint16, allowWrite bool) (web.RemoteServerStatus, error) {
	err := a.remoteServer.Start(web.RemoteServerConfig{
		Port:       port,
		AllowWrite: allowWrite,
	})
	return a.remoteServer.GetStatus(), err
}

// StopRemoteServer stops the Web Remote Server.
func (a *App) StopRemoteServer() web.RemoteServerStatus {
	a.remoteServer.Stop()
	return a.remoteServer.GetStatus()
}

// GetRemoteServerStatus returns the status of Web Remote Server and network adapters.
func (a *App) GetRemoteServerStatus() web.RemoteServerStatus {
	return a.remoteServer.GetStatus()
}

// UpdateRemoteServerState pushes active UI state (tabs/sheets info) to connected phones.
func (a *App) UpdateRemoteServerState(state map[string]interface{}) {
	if a.remoteServer != nil {
		a.remoteServer.BroadcastState(state)
	}
}

