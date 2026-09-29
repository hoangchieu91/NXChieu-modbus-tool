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

// GetOrCreateSession retrieves an existing session or provisions a new one.
func (sm *SessionManager) GetOrCreateSession(sessionID string, role SessionRole) *EngineSession {
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
				if sm.onPollData != nil {
					sm.onPollData(sID, res)
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

// MasterReadOnce executes a single read cycle.
func (sm *SessionManager) MasterReadOnce(sessionID string, def PollDefinition) PollResult {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	res := sess.Master.ExecuteRead(def)
	res.SessionID = sessionID
	return res
}

// MasterWriteRegister writes a single register.
func (sm *SessionManager) MasterWriteRegister(sessionID string, param WriteRegisterParam) error {
	sess := sm.GetOrCreateSession(sessionID, RoleMaster)
	return sess.Master.WriteRegister(param)
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
	store := sess.Slave.GetMemoryStore()
	if store == nil {
		// Provide default initialized store for view even before server is started
		sess.Slave.store = NewSlaveMemoryStore(sessionID, 1, sm.onSlaveAct)
		store = sess.Slave.store
	}
	return store.GetSlice(table, startAddr, qty)
}

// SlaveSetRegister updates a holding or input register in the slave session memory.
func (sm *SessionManager) SlaveSetRegister(sessionID string, table string, addr uint16, val uint16) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	store := sess.Slave.GetMemoryStore()
	if store != nil {
		store.SetRegister(table, addr, val)
	}
}

// SlaveSetCoil updates a coil or discrete input in the slave session memory.
func (sm *SessionManager) SlaveSetCoil(sessionID string, table string, addr uint16, val bool) {
	sess := sm.GetOrCreateSession(sessionID, RoleSlave)
	store := sess.Slave.GetMemoryStore()
	if store != nil {
		store.SetCoil(table, addr, val)
	}
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
