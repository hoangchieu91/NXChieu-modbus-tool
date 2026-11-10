package modbus

import (
	"fmt"
	"strings"
	"sync"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
)

// SlaveMemoryStore holds all 4 standard Modbus memory tables in memory.
type SlaveMemoryStore struct {
	mu               sync.RWMutex
	Coils            [65536]bool
	DiscreteInputs   [65536]bool
	InputRegisters   [65536]uint16
	HoldingRegisters [65536]uint16

	sessionID  string
	slaveID    uint8
	slaveIDEnd uint8
	onActivity func(SlaveActivityEvent)
}

// NewSlaveMemoryStore initializes a memory store with practical default simulation values.
func NewSlaveMemoryStore(sessionID string, slaveID uint8, onActivity func(SlaveActivityEvent)) *SlaveMemoryStore {
	store := &SlaveMemoryStore{
		sessionID:  sessionID,
		slaveID:    slaveID,
		slaveIDEnd: slaveID,
		onActivity: onActivity,
	}

	// Seed with default telemetry values (Voltages, Currents, Temperatures, Status)
	store.HoldingRegisters[0] = 2205 // 220.5 V
	store.HoldingRegisters[1] = 512  // 5.12 A
	store.HoldingRegisters[2] = 1128 // 1128 W
	store.HoldingRegisters[3] = 98   // 0.98 PF
	store.HoldingRegisters[4] = 5000 // 50.00 Hz
	store.HoldingRegisters[5] = 425  // 42.5 °C
	store.HoldingRegisters[6] = 100  // SP = 100%
	store.HoldingRegisters[7] = 0    // Status OK

	// Seed Compressed Air Meter registers (Đồng hồ đo khí nén)
	// 512..513: Flow rate (Int32, scaling 0.01) -> 12500 * 0.01 = 125.00 Nm3/h (0x000030D4)
	store.HoldingRegisters[512] = 0
	store.HoldingRegisters[513] = 12500
	// 514: Pressure (Int16) -> 65 bar (or 6.5 bar scaled) / raw 650
	store.HoldingRegisters[514] = 650
	// 515: Temperature (Int16, scaling 0.1 °C) -> 285 * 0.1 = 28.5 °C
	store.HoldingRegisters[515] = 285
	// 531..532: Total Compressed Air m3 (UInt32, scaling 0.1 m3) -> 15420 * 0.1 = 1542.0 m3 (0x00003C3C)
	store.HoldingRegisters[531] = 0
	store.HoldingRegisters[532] = 15420

	store.InputRegisters[0] = 2400 // 24.0 V DC
	store.InputRegisters[1] = 125  // 12.5 bar
	store.InputRegisters[2] = 300  // 30.0 °C ambient

	store.Coils[0] = true  // Pump 1 Running
	store.Coils[1] = false // Pump 2 Standby
	store.Coils[2] = true  // Auto Mode
	store.Coils[3] = false // Alarm Indicator

	store.DiscreteInputs[0] = true  // E-Stop Healthy
	store.DiscreteInputs[1] = false // Tank High Level
	store.DiscreteInputs[2] = true  // Door Interlock Closed

	return store
}

// checkUnitLocked filters Modbus TCP requests by unit ID. 0 and 255 are the usual "this
// device" IDs on TCP. Any other ID is answered like a gateway with no such target (0x0B);
// "illegal data address" would make scanners report every ID as an existing device.
func (s *SlaveMemoryStore) checkUnitLocked(unitID uint8) error {
	if unitID == 0 || unitID == 255 || s.slaveID == 0 {
		return nil
	}
	endID := s.slaveIDEnd
	if endID < s.slaveID {
		endID = s.slaveID
	}
	if unitID >= s.slaveID && unitID <= endID {
		return nil
	}
	return simonmodbus.ErrGWTargetFailedToRespond
}

// HandleCoils handles FC 01, 05, 15 for Modbus TCP/Server.
func (s *SlaveMemoryStore) HandleCoils(req *simonmodbus.CoilsRequest) ([]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.checkUnitLocked(req.UnitId); err != nil {
		return nil, err
	}

	start := int(req.Addr)
	qty := int(req.Quantity)
	if start+qty > 65536 {
		return nil, simonmodbus.ErrIllegalDataAddress
	}

	if req.IsWrite {
		for i := 0; i < qty && i < len(req.Args); i++ {
			s.Coils[start+i] = req.Args[i]
		}
		if s.onActivity != nil {
			s.onActivity(SlaveActivityEvent{
				SessionID: s.sessionID,
				Timestamp: time.Now().Format("15:04:05.000"),
				Client:    req.ClientAddr,
				Function:  "FC05/15 Write Coils",
				Address:   req.Addr,
				Quantity:  req.Quantity,
				IsWrite:   true,
				Bools:     req.Args,
				Summary:   fmt.Sprintf("Write %d Coil(s) starting @ %d", qty, req.Addr),
			})
		}
		return nil, nil
	}

	// Read
	res := make([]bool, qty)
	for i := 0; i < qty; i++ {
		res[i] = s.Coils[start+i]
	}

	if s.onActivity != nil {
		s.onActivity(SlaveActivityEvent{
			SessionID: s.sessionID,
			Timestamp: time.Now().Format("15:04:05.000"),
			Client:    req.ClientAddr,
			Function:  "FC01 Read Coils",
			Address:   req.Addr,
			Quantity:  req.Quantity,
			IsWrite:   false,
			Bools:     res,
			Summary:   fmt.Sprintf("Read %d Coil(s) starting @ %d", qty, req.Addr),
		})
	}
	return res, nil
}

// HandleDiscreteInputs handles FC 02 for Modbus TCP/Server.
func (s *SlaveMemoryStore) HandleDiscreteInputs(req *simonmodbus.DiscreteInputsRequest) ([]bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if err := s.checkUnitLocked(req.UnitId); err != nil {
		return nil, err
	}

	start := int(req.Addr)
	qty := int(req.Quantity)
	if start+qty > 65536 {
		return nil, simonmodbus.ErrIllegalDataAddress
	}

	res := make([]bool, qty)
	for i := 0; i < qty; i++ {
		res[i] = s.DiscreteInputs[start+i]
	}

	if s.onActivity != nil {
		s.onActivity(SlaveActivityEvent{
			SessionID: s.sessionID,
			Timestamp: time.Now().Format("15:04:05.000"),
			Client:    req.ClientAddr,
			Function:  "FC02 Read Discrete Inputs",
			Address:   req.Addr,
			Quantity:  req.Quantity,
			IsWrite:   false,
			Bools:     res,
			Summary:   fmt.Sprintf("Read %d Discrete Input(s) starting @ %d", qty, req.Addr),
		})
	}
	return res, nil
}

// HandleHoldingRegisters handles FC 03, 06, 16 for Modbus TCP/Server.
func (s *SlaveMemoryStore) HandleHoldingRegisters(req *simonmodbus.HoldingRegistersRequest) ([]uint16, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.checkUnitLocked(req.UnitId); err != nil {
		return nil, err
	}

	start := int(req.Addr)
	qty := int(req.Quantity)
	if start+qty > 65536 {
		return nil, simonmodbus.ErrIllegalDataAddress
	}

	if req.IsWrite {
		for i := 0; i < qty && i < len(req.Args); i++ {
			s.HoldingRegisters[start+i] = req.Args[i]
		}
		if s.onActivity != nil {
			s.onActivity(SlaveActivityEvent{
				SessionID: s.sessionID,
				Timestamp: time.Now().Format("15:04:05.000"),
				Client:    req.ClientAddr,
				Function:  "FC06/16 Write Holding Regs",
				Address:   req.Addr,
				Quantity:  req.Quantity,
				IsWrite:   true,
				Values:    req.Args,
				Summary:   fmt.Sprintf("Write %d Register(s) starting @ %d", qty, req.Addr),
			})
		}
		return nil, nil
	}

	// Read
	res := make([]uint16, qty)
	for i := 0; i < qty; i++ {
		res[i] = s.HoldingRegisters[start+i]
	}

	if s.onActivity != nil {
		s.onActivity(SlaveActivityEvent{
			SessionID: s.sessionID,
			Timestamp: time.Now().Format("15:04:05.000"),
			Client:    req.ClientAddr,
			Function:  "FC03 Read Holding Regs",
			Address:   req.Addr,
			Quantity:  req.Quantity,
			IsWrite:   false,
			Values:    res,
			Summary:   fmt.Sprintf("Read %d Register(s) starting @ %d", qty, req.Addr),
		})
	}
	return res, nil
}

// HandleInputRegisters handles FC 04 for Modbus TCP/Server.
func (s *SlaveMemoryStore) HandleInputRegisters(req *simonmodbus.InputRegistersRequest) ([]uint16, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if err := s.checkUnitLocked(req.UnitId); err != nil {
		return nil, err
	}

	start := int(req.Addr)
	qty := int(req.Quantity)
	if start+qty > 65536 {
		return nil, simonmodbus.ErrIllegalDataAddress
	}

	res := make([]uint16, qty)
	for i := 0; i < qty; i++ {
		res[i] = s.InputRegisters[start+i]
	}

	if s.onActivity != nil {
		s.onActivity(SlaveActivityEvent{
			SessionID: s.sessionID,
			Timestamp: time.Now().Format("15:04:05.000"),
			Client:    req.ClientAddr,
			Function:  "FC04 Read Input Regs",
			Address:   req.Addr,
			Quantity:  req.Quantity,
			IsWrite:   false,
			Values:    res,
			Summary:   fmt.Sprintf("Read %d Input Register(s) starting @ %d", qty, req.Addr),
		})
	}
	return res, nil
}

// Direct Get/Set for frontend UI operations
func (s *SlaveMemoryStore) GetSlice(table string, startAddr uint16, quantity uint16) SlaveMemorySlice {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := SlaveMemorySlice{
		SessionID: s.sessionID,
		Table:     table,
		StartAddr: startAddr,
		Quantity:  quantity,
	}

	start := int(startAddr)
	qty := int(quantity)
	if qty <= 0 {
		qty = 10
	}
	if start+qty > 65536 {
		qty = 65536 - start
	}

	switch strings.ToLower(table) {
	case "coils":
		vals := make([]bool, qty)
		for i := 0; i < qty; i++ {
			vals[i] = s.Coils[start+i]
		}
		res.BoolValues = vals
	case "discrete":
		vals := make([]bool, qty)
		for i := 0; i < qty; i++ {
			vals[i] = s.DiscreteInputs[start+i]
		}
		res.BoolValues = vals
	case "input":
		vals := make([]uint16, qty)
		for i := 0; i < qty; i++ {
			vals[i] = s.InputRegisters[start+i]
		}
		res.Values = vals
	default: // "holding"
		vals := make([]uint16, qty)
		for i := 0; i < qty; i++ {
			vals[i] = s.HoldingRegisters[start+i]
		}
		res.Values = vals
	}

	return res
}

func (s *SlaveMemoryStore) SetRegister(table string, addr uint16, value uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.ToLower(table) == "input" {
		s.InputRegisters[addr] = value
	} else {
		s.HoldingRegisters[addr] = value
	}
}

// ToggleCoil inverts a coil or discrete input atomically.
func (s *SlaveMemoryStore) ToggleCoil(table string, addr uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.ToLower(table) == "discrete" {
		s.DiscreteInputs[addr] = !s.DiscreteInputs[addr]
	} else {
		s.Coils[addr] = !s.Coils[addr]
	}
}

func (s *SlaveMemoryStore) setSlaveID(id uint8) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.slaveID = id
	s.slaveIDEnd = id
}

func (s *SlaveMemoryStore) setSlaveRange(startID uint8, endID uint8) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.slaveID = startID
	if endID >= startID {
		s.slaveIDEnd = endID
	} else {
		s.slaveIDEnd = startID
	}
}

// GetSlaveRange returns the configured start and end slave IDs.
func (s *SlaveMemoryStore) GetSlaveRange() (uint8, uint8) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	startID := s.slaveID
	endID := s.slaveIDEnd
	if endID < startID {
		endID = startID
	}
	return startID, endID
}

func (s *SlaveMemoryStore) SetCoil(table string, addr uint16, value bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.ToLower(table) == "discrete" {
		s.DiscreteInputs[addr] = value
	} else {
		s.Coils[addr] = value
	}
}
