package modbus

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// SessionRole designates whether a session operates as a Master (Poller) or Slave (Server).
type SessionRole string

const (
	RoleMaster SessionRole = "master"
	RoleSlave  SessionRole = "slave"
)

// EngineSession represents a unified engine instance bound to a UI Tab.
type EngineSession struct {
	ID          string
	Role        SessionRole
	Master      *ModbusClientWrapper
	Slave       *ModbusSlaveServer
	pollCancel  context.CancelFunc
	lastSlaveID uint8 // Slave ID of the most recent poll/read, used for remote writes
	mu          sync.Mutex
}

// SessionManager manages concurrent Master and Slave instances across multiple tabs.
type SessionManager struct {
	mu         sync.RWMutex
	sessions   map[string]*EngineSession
	onPollData func(string, PollResult)
	onSlaveAct func(SlaveActivityEvent)
}

// NewSessionManager creates a SessionManager.
func NewSessionManager(onPollData func(string, PollResult), onSlaveAct func(SlaveActivityEvent)) *SessionManager {
	return &SessionManager{
		sessions:   make(map[string]*EngineSession),
		onPollData: onPollData,
		onSlaveAct: onSlaveAct,
	}
}

// normalizeSessionID maps an empty ID to "default" (old single-session callers).
func normalizeSessionID(id string) string {
	if id == "" {
		return "default"
	}
	return id
}

// GetOrCreateSession retrieves an existing session or provisions a new one.
func (sm *SessionManager) GetOrCreateSession(sessionID string, role SessionRole) *EngineSession {
	sessionID = normalizeSessionID(sessionID)
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sess, exists := sm.sessions[sessionID]; exists {
		if role != "" && sess.Role != role {
			sess.Role = role
		}
		return sess
	}

	if role == "" {
		role = RoleMaster
	}

	sess := &EngineSession{
		ID:     sessionID,
		Role:   role,
		Master: NewModbusClientWrapper(),
		Slave:  NewModbusSlaveServer(sessionID, sm.onSlaveAct),
	}
	sm.sessions[sessionID] = sess
	return sess
}

// CloseSession gracefully tears down a session and releases serial/socket resources.
func (sm *SessionManager) CloseSession(sessionID string) {
	sessionID = normalizeSessionID(sessionID)
	sm.mu.Lock()
	sess, exists := sm.sessions[sessionID]
	if exists {
		delete(sm.sessions, sessionID)
	}
	sm.mu.Unlock()

	if exists && sess != nil {
		sess.mu.Lock()
		defer sess.mu.Unlock()

		if sess.pollCancel != nil {
			sess.pollCancel()
			sess.pollCancel = nil
		}
		if sess.Master != nil {
			sess.Master.Disconnect()
		}
		if sess.Slave != nil {
			sess.Slave.Stop()
		}
	}
}

// MasterConnect connects a session's master client.
func (sm *SessionManager) MasterConnect(sessionID string, config ConnectionConfig) (string, error) {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.Role = RoleMaster
	return sess.Master.Connect(config)
}

// MasterDisconnect disconnects a session's master client and stops its polling loop.
func (sm *SessionManager) MasterDisconnect(sessionID string) {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.pollCancel != nil {
		sess.pollCancel()
		sess.pollCancel = nil
	}
	sess.Master.Disconnect()
}

// MasterStartPolling initiates periodic polling on the target session.
func (sm *SessionManager) MasterStartPolling(sessionID string, def PollDefinition) error {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if !sess.Master.IsConnected() {
		return fmt.Errorf("session %s: not connected", sessionID)
	}

	if sess.pollCancel != nil {
		sess.pollCancel()
		sess.pollCancel = nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	sess.pollCancel = cancel
	sess.lastSlaveID = def.SlaveID

	scanRate := def.ScanRateMs
	if scanRate < 50 {
		scanRate = 50
	}

	go func(pollCtx context.Context, sID string, client *ModbusClientWrapper, pDef PollDefinition) {
		ticker := time.NewTicker(time.Duration(scanRate) * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-pollCtx.Done():
				return
			case <-ticker.C:
				if !client.IsConnected() {
					return
				}
				res := client.ExecuteRead(pDef)
				res.SessionID = sID
				// A read that was in flight when polling was stopped or restarted belongs to the
				// old definition. Checking under sess.mu (which Stop/Start hold while cancelling)
				// guarantees no stale result is emitted after the new run has started.
				sess.mu.Lock()
				stale := pollCtx.Err() != nil
				if !stale && sm.onPollData != nil {
					sm.onPollData(sID, res)
				}
				sess.mu.Unlock()
				if stale {
					return
				}
			}
		}
	}(ctx, sessionID, sess.Master, def)

	return nil
}

// MasterStopPolling stops periodic polling on the session.
func (sm *SessionManager) MasterStopPolling(sessionID string) {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.pollCancel != nil {
		sess.pollCancel()
		sess.pollCancel = nil
	}
}

// MasterResetCounters zeroes the session's TX/error counters.
func (sm *SessionManager) MasterResetCounters(sessionID string) {
	sm.GetOrCreateSession(sessionID, RoleMaster).Master.ResetCounters()
}

// MasterReadOnce executes a single read cycle.
func (sm *SessionManager) MasterReadOnce(sessionID string, def PollDefinition) PollResult {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	sess.mu.Lock()
	sess.lastSlaveID = def.SlaveID
	sess.mu.Unlock()
	res := sess.Master.ExecuteRead(def)
	res.SessionID = sessionID
	return res
}

// MasterLastSlaveID returns the Slave ID last used for polling on the session (0 if unknown).
func (sm *SessionManager) MasterLastSlaveID(sessionID string) uint8 {
	sessionID = normalizeSessionID(sessionID)
	sm.mu.RLock()
	sess, exists := sm.sessions[sessionID]
	sm.mu.RUnlock()
	if !exists {
		return 0
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	return sess.lastSlaveID
}

// MasterWriteRegister writes a single register.
func (sm *SessionManager) MasterWriteRegister(sessionID string, param WriteRegisterParam) error {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	return sess.Master.WriteRegister(param)
}

// MasterWriteRegisters writes multiple registers (FC 16).
func (sm *SessionManager) MasterWriteRegisters(sessionID string, param WriteRegistersParam) error {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	return sess.Master.WriteRegisters(param)
}

// MasterWriteCoil writes a single coil.
func (sm *SessionManager) MasterWriteCoil(sessionID string, param WriteCoilParam) error {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	return sess.Master.WriteCoil(param)
}

// SlaveStart starts the Modbus Slave server on the target session.
func (sm *SessionManager) SlaveStart(sessionID string, config SlaveConfig) error {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.Role = RoleSlave
	return sess.Slave.Start(config)
}

// SlaveStop stops the Modbus Slave server on the target session.
func (sm *SessionManager) SlaveStop(sessionID string) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.Slave.Stop()
}

// SlaveGetSlice retrieves memory slice from the slave session.
func (sm *SessionManager) SlaveGetSlice(sessionID string, table string, startAddr uint16, qty uint16) SlaveMemorySlice {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	return sess.Slave.GetMemoryStore().GetSlice(table, startAddr, qty)
}

// SlaveSetRegister updates a holding or input register in the slave session memory.
func (sm *SessionManager) SlaveSetRegister(sessionID string, table string, addr uint16, val uint16) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.Slave.GetMemoryStore().SetRegister(table, addr, val)
}

// SlaveSetCoil updates a coil or discrete input in the slave session memory.
func (sm *SessionManager) SlaveSetCoil(sessionID string, table string, addr uint16, val bool) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.Slave.GetMemoryStore().SetCoil(table, addr, val)
}

// SlaveStartSimulation starts auto simulation.
func (sm *SessionManager) SlaveStartSimulation(sessionID string, config SimulationConfig) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.Slave.StartSimulation(config)
}

// SlaveStopSimulation halts simulation.
func (sm *SessionManager) SlaveStopSimulation(sessionID string) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	sess.Slave.StopSimulation()
}

// ScanSlaveIDs probes a range of Slave IDs on the session's master connection.
func (sm *SessionManager) ScanSlaveIDs(sessionID string, startID, endID uint8, timeoutMs uint) []SlaveScanItem {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	return sess.Master.ScanSlaveRange(startID, endID, timeoutMs)
}

// ScanRegisters scans a range of registers on the session's master connection.
func (sm *SessionManager) ScanRegisters(sessionID string, fc uint8, startAddr, endAddr uint16) []RegisterScanItem {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	slaveID := sm.MasterLastSlaveID(sessionID)
	if slaveID == 0 {
		slaveID = 1
	}
	return sess.Master.ScanRegisters(slaveID, fc, startAddr, endAddr)
}

