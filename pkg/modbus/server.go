package modbus

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net"
	"strings"
	"sync"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
	"go.bug.st/serial"
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
	onActivity func(SlaveActivityEvent)
}

// NewSlaveMemoryStore initializes a memory store with practical default simulation values.
func NewSlaveMemoryStore(sessionID string, slaveID uint8, onActivity func(SlaveActivityEvent)) *SlaveMemoryStore {
	store := &SlaveMemoryStore{
		sessionID:  sessionID,
		slaveID:    slaveID,
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

// HandleCoils handles FC 01, 05, 15 for Modbus TCP/Server.
func (s *SlaveMemoryStore) HandleCoils(req *simonmodbus.CoilsRequest) ([]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req.UnitId != 0 && s.slaveID != 0 && req.UnitId != s.slaveID {
		return nil, simonmodbus.ErrIllegalDataAddress
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

	if req.UnitId != 0 && s.slaveID != 0 && req.UnitId != s.slaveID {
		return nil, simonmodbus.ErrIllegalDataAddress
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

	if req.UnitId != 0 && s.slaveID != 0 && req.UnitId != s.slaveID {
		return nil, simonmodbus.ErrIllegalDataAddress
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

	if req.UnitId != 0 && s.slaveID != 0 && req.UnitId != s.slaveID {
		return nil, simonmodbus.ErrIllegalDataAddress
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

func (s *SlaveMemoryStore) SetCoil(table string, addr uint16, value bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.ToLower(table) == "discrete" {
		s.DiscreteInputs[addr] = value
	} else {
		s.Coils[addr] = value
	}
}

// ModbusSlaveServer encapsulates TCP, Serial RTU, and RTU-over-TCP slave servers.
type ModbusSlaveServer struct {
	mu           sync.Mutex
	sessionID    string
	config       SlaveConfig
	store        *SlaveMemoryStore
	isListening  bool
	tcpServer    *simonmodbus.ModbusServer
	tcpListener  net.Listener
	serialPort   serial.Port
	stopChan     chan struct{}
	simCancel    context.CancelFunc
	onActivity   func(SlaveActivityEvent)
}

// NewModbusSlaveServer creates an instance of ModbusSlaveServer.
func NewModbusSlaveServer(sessionID string, onActivity func(SlaveActivityEvent)) *ModbusSlaveServer {
	return &ModbusSlaveServer{
		sessionID:  sessionID,
		onActivity: onActivity,
	}
}

// IsListening returns true if the slave server is actively accepting requests.
func (s *ModbusSlaveServer) IsListening() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isListening
}

// GetMemoryStore returns the underlying memory store.
func (s *ModbusSlaveServer) GetMemoryStore() *SlaveMemoryStore {
	return s.store
}

// Start launches the Modbus Slave server according to config.
func (s *ModbusSlaveServer) Start(config SlaveConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isListening {
		s.stopLocked()
	}

	s.config = config
	slaveID := config.SlaveID
	if slaveID == 0 {
		slaveID = 1
	}

	s.store = NewSlaveMemoryStore(s.sessionID, slaveID, s.onActivity)
	s.stopChan = make(chan struct{})

	switch strings.ToLower(config.Type) {
	case "tcp":
		host := config.Host
		if host == "" {
			host = "0.0.0.0"
		}
		port := config.TcpPort
		if port == 0 {
			port = 502
		}

		serverURL := fmt.Sprintf("tcp://%s:%d", host, port)
		serverConfig := &simonmodbus.ServerConfiguration{
			URL:        serverURL,
			Timeout:    30 * time.Second,
			MaxClients: 32,
		}

		srv, err := simonmodbus.NewServer(serverConfig, s.store)
		if err != nil {
			return fmt.Errorf("failed to create modbus TCP server: %w", err)
		}

		if err := srv.Start(); err != nil {
			return fmt.Errorf("failed to start modbus TCP server on %s: %w", serverURL, err)
		}

		s.tcpServer = srv
		s.isListening = true

	case "rtu_over_tcp", "rtuovertcp":
		host := config.Host
		if host == "" {
			host = "0.0.0.0"
		}
		port := config.TcpPort
		if port == 0 {
			port = 5020
		}

		addr := fmt.Sprintf("%s:%d", host, port)
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			return fmt.Errorf("failed to start RTU-over-TCP listener on %s: %w", addr, err)
		}
		s.tcpListener = ln
		s.isListening = true

		go s.runRTUOverTCPLoop(ln)

	case "serial":
		if config.Port == "" {
			return fmt.Errorf("serial port name cannot be empty")
		}

		baud := int(config.BaudRate)
		if baud == 0 {
			baud = 9600
		}
		dataBits := int(config.DataBits)
		if dataBits == 0 {
			dataBits = 8
		}
		var parity serial.Parity = serial.NoParity
		switch strings.ToLower(config.Parity) {
		case "even":
			parity = serial.EvenParity
		case "odd":
			parity = serial.OddParity
		}
		var stopBits serial.StopBits = serial.OneStopBit
		if config.StopBits == 2 {
			stopBits = serial.TwoStopBits
		}

		// Windows COM port name formatting
		portName := strings.TrimSpace(config.Port)
		if idx := strings.Index(portName, " "); idx != -1 {
			portName = portName[:idx]
		}
		portName = strings.TrimSpace(portName)
		if strings.HasPrefix(strings.ToUpper(portName), "COM") && !strings.HasPrefix(portName, `\\.\`) {
			portName = `\\.\` + strings.ToUpper(portName)
		}

		mode := &serial.Mode{
			BaudRate: baud,
			DataBits: dataBits,
			Parity:   parity,
			StopBits: stopBits,
		}

		sp, err := serial.Open(portName, mode)
		if err != nil {
			return fmt.Errorf("failed to open serial port %s: %w", portName, err)
		}
		s.serialPort = sp
		s.isListening = true

		go s.runSerialRTULoop(sp)

	default:
		return fmt.Errorf("unsupported slave type: %s", config.Type)
	}

	return nil
}

// Stop gracefully shuts down the slave server.
func (s *ModbusSlaveServer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *ModbusSlaveServer) stopLocked() {
	if s.simCancel != nil {
		s.simCancel()
		s.simCancel = nil
	}

	if s.stopChan != nil {
		close(s.stopChan)
		s.stopChan = nil
	}

	if s.tcpServer != nil {
		_ = s.tcpServer.Stop()
		s.tcpServer = nil
	}

	if s.tcpListener != nil {
		_ = s.tcpListener.Close()
		s.tcpListener = nil
	}

	if s.serialPort != nil {
		_ = s.serialPort.Close()
		s.serialPort = nil
	}

	s.isListening = false
}

// RTU over TCP server listener loop
func (s *ModbusSlaveServer) runRTUOverTCPLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go s.handleRTUConnection(conn, conn.RemoteAddr().String())
	}
}

// Serial RTU server read loop
func (s *ModbusSlaveServer) runSerialRTULoop(sp serial.Port) {
	s.handleRTUConnection(sp, "Serial "+s.config.Port)
}

func (s *ModbusSlaveServer) handleRTUConnection(rw io.ReadWriter, clientAddr string) {
	buf := make([]byte, 512)
	for {
		s.mu.Lock()
		active := s.isListening
		s.mu.Unlock()
		if !active {
			return
		}

		n, err := rw.Read(buf)
		if err != nil {
			return
		}
		if n < 4 {
			continue
		}

		frame := buf[:n]
		resp, err := s.processRTUFrame(frame, clientAddr)
		if err == nil && len(resp) > 0 {
			_, _ = rw.Write(resp)
		}
	}
}

// processRTUFrame validates CRC and handles Modbus FC 01, 02, 03, 04, 05, 06, 0F, 10
func (s *ModbusSlaveServer) processRTUFrame(frame []byte, clientAddr string) ([]byte, error) {
	if len(frame) < 4 {
		return nil, fmt.Errorf("frame too short")
	}

	// Validate CRC
	n := len(frame)
	expectedCRC := binary.LittleEndian.Uint16(frame[n-2:])
	computedCRC := CRC16Modbus(frame[:n-2])
	if expectedCRC != computedCRC {
		return nil, fmt.Errorf("crc error")
	}

	unitID := frame[0]
	if unitID != 0 && s.config.SlaveID != 0 && unitID != s.config.SlaveID {
		return nil, fmt.Errorf("unit id mismatch")
	}

	fc := frame[1]
	switch fc {
	case 0x01: // Read Coils
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC01")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		bools, err := s.store.HandleCoils(&simonmodbus.CoilsRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   qty,
			IsWrite:    false,
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		return s.buildBitReadResponse(unitID, fc, bools), nil

	case 0x02: // Read Discrete Inputs
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC02")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		bools, err := s.store.HandleDiscreteInputs(&simonmodbus.DiscreteInputsRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   qty,
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		return s.buildBitReadResponse(unitID, fc, bools), nil

	case 0x03: // Read Holding Registers
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC03")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		regs, err := s.store.HandleHoldingRegisters(&simonmodbus.HoldingRegistersRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   qty,
			IsWrite:    false,
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		return s.buildRegisterReadResponse(unitID, fc, regs), nil

	case 0x04: // Read Input Registers
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC04")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		regs, err := s.store.HandleInputRegisters(&simonmodbus.InputRegistersRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   qty,
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		return s.buildRegisterReadResponse(unitID, fc, regs), nil

	case 0x05: // Write Single Coil
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC05")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		rawVal := binary.BigEndian.Uint16(frame[4:6])
		val := rawVal == 0xFF00
		_, err := s.store.HandleCoils(&simonmodbus.CoilsRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   1,
			IsWrite:    true,
			Args:       []bool{val},
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		// FC05 echoes back request frame on success
		return frame[:6+2], nil

	case 0x06: // Write Single Register
		if len(frame) < 6 {
			return nil, fmt.Errorf("malformed FC06")
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		val := binary.BigEndian.Uint16(frame[4:6])
		_, err := s.store.HandleHoldingRegisters(&simonmodbus.HoldingRegistersRequest{
			ClientAddr: clientAddr,
			UnitId:     unitID,
			Addr:       addr,
			Quantity:   1,
			IsWrite:    true,
			Args:       []uint16{val},
		})
		if err != nil {
			return s.buildExceptionResponse(unitID, fc, 0x02), nil
		}
		// FC06 echoes back request frame on success
		return frame[:6+2], nil

	default:
		// Unsupported function code -> Exception 0x01 (Illegal Function)
		return s.buildExceptionResponse(unitID, fc, 0x01), nil
	}
}

func (s *ModbusSlaveServer) buildBitReadResponse(unitID uint8, fc uint8, bools []bool) []byte {
	byteCount := byte((len(bools) + 7) / 8)
	resp := make([]byte, 3+int(byteCount)+2)
	resp[0] = unitID
	resp[1] = fc
	resp[2] = byteCount

	for i, b := range bools {
		if b {
			resp[3+(i/8)] |= (1 << (i % 8))
		}
	}

	crc := CRC16Modbus(resp[:3+int(byteCount)])
	binary.LittleEndian.PutUint16(resp[3+int(byteCount):], crc)
	return resp
}

func (s *ModbusSlaveServer) buildRegisterReadResponse(unitID uint8, fc uint8, regs []uint16) []byte {
	byteCount := byte(len(regs) * 2)
	resp := make([]byte, 3+int(byteCount)+2)
	resp[0] = unitID
	resp[1] = fc
	resp[2] = byteCount

	for i, reg := range regs {
		binary.BigEndian.PutUint16(resp[3+(i*2):], reg)
	}

	crc := CRC16Modbus(resp[:3+int(byteCount)])
	binary.LittleEndian.PutUint16(resp[3+int(byteCount):], crc)
	return resp
}

func (s *ModbusSlaveServer) buildExceptionResponse(unitID uint8, fc uint8, exceptionCode byte) []byte {
	resp := make([]byte, 5)
	resp[0] = unitID
	resp[1] = fc | 0x80
	resp[2] = exceptionCode
	crc := CRC16Modbus(resp[:3])
	binary.LittleEndian.PutUint16(resp[3:], crc)
	return resp
}

// StartSimulation activates automatic mathematical or randomized fluctuation on selected registers.
func (s *ModbusSlaveServer) StartSimulation(config SimulationConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.simCancel != nil {
		s.simCancel()
		s.simCancel = nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.simCancel = cancel

	interval := time.Duration(config.IntervalMs) * time.Millisecond
	if interval < 100*time.Millisecond {
		interval = 1000 * time.Millisecond
	}

	go func(simCtx context.Context, cfg SimulationConfig) {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		var angle float64 = 0.0
		var currentVal float64 = cfg.Min

		for {
			select {
			case <-simCtx.Done():
				return
			case <-ticker.C:
				switch strings.ToLower(cfg.Mode) {
				case "random":
					span := cfg.Max - cfg.Min
					if span <= 0 {
						span = 100
					}
					currentVal = cfg.Min + rand.Float64()*span

				case "sine":
					angle += 0.1
					if angle > 2*math.Pi {
						angle = 0
					}
					span := cfg.Max - cfg.Min
					if span <= 0 {
						span = 100
					}
					currentVal = cfg.Min + (span/2.0)*(1.0+math.Sin(angle))

				case "toggle":
					b := s.store.Coils[cfg.Address]
					s.store.SetCoil(cfg.Table, cfg.Address, !b)
					continue

				default: // "increment"
					step := cfg.Step
					if step <= 0 {
						step = 1
					}
					currentVal += step
					if cfg.Max > cfg.Min && currentVal > cfg.Max {
						currentVal = cfg.Min
					}
				}

				if currentVal < 0 {
					currentVal = 0
				}
				if currentVal > 65535 {
					currentVal = 65535
				}
				s.store.SetRegister(cfg.Table, cfg.Address, uint16(math.Round(currentVal)))
			}
		}
	}(ctx, config)
}

// StopSimulation halts background data simulation.
func (s *ModbusSlaveServer) StopSimulation() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.simCancel != nil {
		s.simCancel()
		s.simCancel = nil
	}
}
