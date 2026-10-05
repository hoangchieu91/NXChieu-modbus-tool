package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"nxchieu-modbus-tool/pkg/modbus"
	"nxchieu-modbus-tool/pkg/sniffer"
	"nxchieu-modbus-tool/pkg/web"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct manages application state and bridges Wails frontend calls.
type App struct {
	ctx     context.Context
	mu      sync.Mutex
	sessMgr *modbus.SessionManager
	sniffer *sniffer.Engine
	capture *sniffer.SessionManager
	// diagnosticSniffer receives traffic of the built-in self-test sessions, so simulator
	// traffic never enters the user's baseline, health score, reports or saved captures.
	diagnosticSniffer *sniffer.Engine
	remoteServer      *web.RemoteServer

	pendingWrites map[string]chan string // remote writes awaiting the desktop UI, by request id
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{sniffer: sniffer.NewEngine(50000), diagnosticSniffer: sniffer.NewEngine(2000)}
	app.capture = sniffer.NewSessionManager(app.sniffer)

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
			app.ingestPollResult(sessionID, res)
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, "poll-data", res)
			}
			if app.remoteServer != nil {
				app.remoteServer.BroadcastPollResult(sessionID, res)
			}
		},
		func(act modbus.SlaveActivityEvent) {
			// Some slave transports can provide the observed request bytes. Keep them in the same
			// analyzer pipeline; empty HexRaw events still update the existing activity UI only.
			if act.HexRaw != "" {
				dir := sniffer.DirectionMasterToSlave
				if act.IsWrite {
					dir = sniffer.DirectionSlaveToMaster
				}
				_, _ = app.snifferFor(act.SessionID).AddHex(act.SessionID, dir, act.HexRaw, sniffer.QualityWire)
			}
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, "slave-activity", act)
			}
		},
	)

	return app
}

// diagnosticSessionPrefix marks sessions created by the Studio self-test.
const diagnosticSessionPrefix = "__studio_diagnostic_"

// snifferFor returns the analyzer that records a session's traffic.
func (a *App) snifferFor(sessionID string) *sniffer.Engine {
	if strings.HasPrefix(sessionID, diagnosticSessionPrefix) {
		return a.diagnosticSniffer
	}
	return a.sniffer
}

// GetDiagnosticSnifferSnapshot returns frames recorded for the self-test sessions only.
func (a *App) GetDiagnosticSnifferSnapshot(limit int) sniffer.Snapshot {
	return a.diagnosticSniffer.Snapshot(limit)
}

// ingestPollResult keeps polling and Read Once on the same analyzer path.
func (a *App) ingestPollResult(sessionID string, res modbus.PollResult) {
	engine := a.snifferFor(sessionID)
	// The current master library does not expose its transport, so these frames are explicitly
	// marked reconstructed rather than claiming a passive wire capture.
	if res.RawTx != "" && res.RawRx != "" {
		_ = engine.AddHexPair(sessionID, res.RawTx, res.RawRx, sniffer.QualityReconstructed, time.Duration(res.LatencyMs)*time.Millisecond)
	} else if res.RawTx != "" {
		frame, err := engine.AddHex(sessionID, sniffer.DirectionMasterToSlave, res.RawTx, sniffer.QualityReconstructed)
		if err == nil && res.Error != "" {
			engine.MarkTimedOut(frame.Sequence)
		}
	} else if res.RawRx != "" {
		_, _ = engine.AddHex(sessionID, sniffer.DirectionSlaveToMaster, res.RawRx, sniffer.QualityReconstructed)
	}
}

var remoteWriteSeq atomic.Uint64

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

	// A counter, not the clock: Windows timestamps can repeat for writes a few ms apart.
	id := fmt.Sprintf("rw-%d", remoteWriteSeq.Add(1))
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

func (a *App) shutdown(ctx context.Context) {
	if a.capture != nil {
		a.capture.Stop()
	}
	if a.remoteServer != nil {
		a.remoteServer.Stop()
	}
}

// ListSerialPorts returns available COM ports on the system.
func (a *App) ListSerialPorts() []modbus.SerialPortDetail {
	return modbus.ListSerialPorts()
}

// CloseSession closes and frees resources associated with a tab session.
func (a *App) CloseSession(sessionID string) {
	a.sessMgr.CloseSession(sessionID)
}

// --- Session-Aware Master Operations ---

// SessionConnect connects a tab session's Master client to Serial, TCP, RTU over TCP, or Simulator.
func (a *App) SessionConnect(sessionID string, config modbus.ConnectionConfig) (string, error) {
	return a.sessMgr.MasterConnect(sessionID, config)
}

// SessionDisconnect disconnects a tab session's Master client.
func (a *App) SessionDisconnect(sessionID string) {
	a.sessMgr.MasterDisconnect(sessionID)
}

// SessionStartPolling begins polling on a session.
func (a *App) SessionStartPolling(sessionID string, def modbus.PollDefinition) error {
	return a.sessMgr.MasterStartPolling(sessionID, def)
}

// SessionStopPolling pauses polling on a session.
func (a *App) SessionStopPolling(sessionID string) {
	a.sessMgr.MasterStopPolling(sessionID)
}

// SessionReadOnce executes a single read on a session.
func (a *App) SessionReadOnce(sessionID string, def modbus.PollDefinition) modbus.PollResult {
	result := a.sessMgr.MasterReadOnce(sessionID, def)
	a.ingestPollResult(sessionID, result)
	return result
}

// SessionWriteRegister writes a 16-bit register on a session.
func (a *App) SessionWriteRegister(sessionID string, param modbus.WriteRegisterParam) error {
	return a.sessMgr.MasterWriteRegister(sessionID, param)
}

// SessionWriteRegisters writes multiple 16-bit registers on a session (FC 16).
func (a *App) SessionWriteRegisters(sessionID string, param modbus.WriteRegistersParam) error {
	return a.sessMgr.MasterWriteRegisters(sessionID, param)
}

// SessionWriteCoil writes a single coil on a session.
func (a *App) SessionWriteCoil(sessionID string, param modbus.WriteCoilParam) error {
	return a.sessMgr.MasterWriteCoil(sessionID, param)
}

// SessionResetCounters zeroes a session's TX/error counters (the toolbar's Clear counters).
func (a *App) SessionResetCounters(sessionID string) {
	a.sessMgr.MasterResetCounters(sessionID)
}

// SessionGetConnectionStatus returns true if session master is connected.
func (a *App) SessionGetConnectionStatus(sessionID string) bool {
	sess := a.sessMgr.GetOrCreateSession(sessionID, modbus.RoleMaster)
	return sess.Master.IsConnected()
}

// --- Modbus Slave (Server Simulator) Operations ---

// SlaveStart launches the Modbus Slave server for a session.
func (a *App) SlaveStart(sessionID string, config modbus.SlaveConfig) error {
	return a.sessMgr.SlaveStart(sessionID, config)
}

// SlaveStop stops the Modbus Slave server for a session.
func (a *App) SlaveStop(sessionID string) {
	a.sessMgr.SlaveStop(sessionID)
}

// SlaveGetSlice reads memory registers or coils from a slave session to render on the UI.
func (a *App) SlaveGetSlice(sessionID string, table string, startAddr uint16, qty uint16) modbus.SlaveMemorySlice {
	return a.sessMgr.SlaveGetSlice(sessionID, table, startAddr, qty)
}

// SlaveSetRegister modifies a holding or input register in the slave memory table.
func (a *App) SlaveSetRegister(sessionID string, table string, addr uint16, val uint16) {
	a.sessMgr.SlaveSetRegister(sessionID, table, addr, val)
}

// SlaveSetCoil modifies a coil or discrete input in the slave memory table.
func (a *App) SlaveSetCoil(sessionID string, table string, addr uint16, val bool) {
	a.sessMgr.SlaveSetCoil(sessionID, table, addr, val)
}

// SlaveStartSim triggers background automated value fluctuation.
func (a *App) SlaveStartSim(sessionID string, config modbus.SimulationConfig) {
	a.sessMgr.SlaveStartSimulation(sessionID, config)
}

// SlaveStopSim halts background simulation.
func (a *App) SlaveStopSim(sessionID string) {
	a.sessMgr.SlaveStopSimulation(sessionID)
}

// --- Diagnostic & Scanning Tools ---

// ScanSlaveIDs scans a range of slave IDs [startID, endID] on the given session.
func (a *App) ScanSlaveIDs(sessionID string, startID, endID uint8, timeoutMs uint) []modbus.SlaveScanItem {
	return a.sessMgr.ScanSlaveIDs(sessionID, startID, endID, timeoutMs)
}

// AutoDetectBaudrate probes multiple Baudrate & Parity configurations on a COM port.
func (a *App) AutoDetectBaudrate(port string, slaveID uint8, bauds []uint, parities []string) []modbus.BaudScanItem {
	return modbus.AutoDetectBaudrate(port, slaveID, bauds, parities)
}

// ScanRegisters scans a range of register addresses to inspect availability.
func (a *App) ScanRegisters(sessionID string, fc uint8, startAddr, endAddr uint16) []modbus.RegisterScanItem {
	return a.sessMgr.ScanRegisters(sessionID, fc, startAddr, endAddr)
}

// GetSnifferSnapshot returns a bounded page of recent decoded frames and the accumulated
// bus/device health summary. A limit of zero returns every frame currently retained.
func (a *App) GetSnifferSnapshot(limit int) sniffer.Snapshot {
	return a.sniffer.Snapshot(limit)
}

// ClearSniffer clears captured frames, pending transactions and learned health statistics.
func (a *App) ClearSniffer() {
	a.sniffer.Clear()
}

// SetSnifferBaselineMode toggles between baseline learning ("learn"), monitoring ("monitor") and disabled ("off").
func (a *App) SetSnifferBaselineMode(mode string) sniffer.BaselineProfile {
	return a.sniffer.SetBaselineMode(sniffer.BaselineMode(mode))
}

// GetSnifferBaseline returns the current baseline profile including median poll intervals and P95 latencies.
func (a *App) GetSnifferBaseline() sniffer.BaselineProfile {
	return a.sniffer.GetBaseline()
}

// ResetSnifferBaseline clears all learned baseline statistics.
func (a *App) ResetSnifferBaseline() sniffer.BaselineProfile {
	return a.sniffer.ResetBaseline()
}

// StartSniffer starts a TCP proxy, RTU-over-TCP proxy or read-only serial capture session.
func (a *App) StartSniffer(config sniffer.CaptureConfig) (sniffer.CaptureStatus, error) {
	return a.capture.Start(config)
}

func (a *App) StopSniffer() sniffer.CaptureStatus {
	return a.capture.Stop()
}

func (a *App) GetSnifferStatus() sniffer.CaptureStatus {
	return a.capture.Status()
}

// SaveSnifferCapture opens a native save dialog and writes the bounded capture as .nxcap JSON.
func (a *App) SaveSnifferCapture() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Lưu Modbus capture",
		DefaultFilename: "modbus-capture.nxcap",
		Filters:         []runtime.FileFilter{{DisplayName: "NXChieu Capture (*.nxcap)", Pattern: "*.nxcap"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	return path, sniffer.SaveCaptureWithMetadata(path, a.sniffer.Snapshot(0), a.sniffer.GetProfileCatalog())
}

func (a *App) OpenSnifferCapture() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Mở Modbus capture",
		Filters: []runtime.FileFilter{{DisplayName: "NXChieu Capture (*.nxcap)", Pattern: "*.nxcap"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	// Validated first, then streamed into the analyzer: a broken file leaves the current
	// capture untouched and a large one is never held in memory as a whole.
	if _, err := sniffer.LoadCaptureInto(path, a.sniffer); err != nil {
		return path, err
	}
	return path, nil
}

// PickCaptureFile opens an Open File dialog without replacing the current active sniffer frames.
func (a *App) PickCaptureFile(title string) (string, error) {
	if title == "" {
		title = "Chọn tệp Modbus capture (.nxcap)"
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: []runtime.FileFilter{{DisplayName: "NXChieu Capture (*.nxcap)", Pattern: "*.nxcap"}},
	})
}

func (a *App) ExportSnifferCSV() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Xuất báo cáo Modbus CSV",
		DefaultFilename: "modbus-report.csv",
		Filters:         []runtime.FileFilter{{DisplayName: "CSV (*.csv)", Pattern: "*.csv"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	return path, sniffer.ExportCSV(path, a.sniffer.Snapshot(0))
}

// LoadSnifferProfileFile opens a file dialog to import a register profile catalog (.nxprof or .json).
func (a *App) LoadSnifferProfileFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Nạp Profile thanh ghi thiết bị Modbus",
		Filters: []runtime.FileFilter{{DisplayName: "Modbus Profile (*.nxprof;*.json)", Pattern: "*.nxprof;*.json"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	cat, err := sniffer.LoadProfileCatalogFile(path)
	if err != nil {
		return path, err
	}
	a.sniffer.SetProfileCatalog(cat)
	return path, nil
}

// SetSnifferProfileCatalog sets the active profile catalog from a JSON string.
func (a *App) SetSnifferProfileCatalog(jsonContent string) error {
	cat, err := sniffer.LoadProfileCatalog([]byte(jsonContent))
	if err != nil {
		return err
	}
	a.sniffer.SetProfileCatalog(cat)
	return nil
}

// GetSnifferProfileCatalog returns the currently loaded profile catalog.
func (a *App) GetSnifferProfileCatalog() *sniffer.ProfileCatalog {
	return a.sniffer.GetProfileCatalog()
}

// CompareSnifferCaptures performs differential health analysis between two capture files.
func (a *App) CompareSnifferCaptures(pathA, pathB string) (*sniffer.CaptureDiffResult, error) {
	return sniffer.DiffCaptureFiles(pathA, pathB)
}

// ExportSnifferHTMLReport exports a self-contained, printable HTML Shift Health Report.
func (a *App) ExportSnifferHTMLReport(opts sniffer.ShiftReportOptions) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Xuất Báo Cáo Sức Khỏe Modbus (HTML)",
		DefaultFilename: "modbus-shift-report.html",
		Filters:         []runtime.FileFilter{{DisplayName: "HTML Report (*.html)", Pattern: "*.html"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	return path, sniffer.ExportShiftReport(path, a.sniffer.Snapshot(0), opts)
}

// OpenProjectFile opens a native Open File dialog to pick a .nxmodbus project file and returns its content.
func (a *App) OpenProjectFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Mở dự án Modbus (.nxmodbus)",
		Filters: []runtime.FileFilter{
			{DisplayName: "Dự Án Modbus (*.nxmodbus;*.json)", Pattern: "*.nxmodbus;*.json"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("không thể đọc file dự án: %w", err)
	}
	return string(content), nil
}

// LoadDefaultProject reads the default project file (e.g. COM3_Master_Slaves_Simulation.nxmodbus) from current dir if it exists.
func (a *App) LoadDefaultProject() string {
	candidateFiles := []string{
		"COM3_Master_Slaves_Simulation.nxmodbus",
		filepath.Join(".", "COM3_Master_Slaves_Simulation.nxmodbus"),
	}
	for _, f := range candidateFiles {
		if content, err := os.ReadFile(f); err == nil && len(content) > 0 {
			return string(content)
		}
	}
	return ""
}

// CheckNpcapStatus checks whether the Npcap/WinPcap driver is installed and lists adapters.
func (a *App) CheckNpcapStatus() sniffer.NpcapStatus {
	return sniffer.CheckNpcapStatus()
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
