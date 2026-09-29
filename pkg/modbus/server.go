package modbus

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
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

// checkUnitLocked filters Modbus TCP requests by unit ID. 0 and 255 are the usual "this
// device" IDs on TCP. Any other ID is answered like a gateway with no such target (0x0B);
// "illegal data address" would make scanners report every ID as an existing device.
func (s *SlaveMemoryStore) checkUnitLocked(unitID uint8) error {
	if unitID == 0 || unitID == 255 || s.slaveID == 0 || unitID == s.slaveID {
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
	tcpConns     map[net.Conn]struct{}
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

// GetMemoryStore returns the underlying memory store, creating a default one if the server
// has not been started yet so the UI and simulation can work before Start.
func (s *ModbusSlaveServer) GetMemoryStore() *SlaveMemoryStore {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.store == nil {
		s.store = NewSlaveMemoryStore(s.sessionID, 1, s.onActivity)
	}
	return s.store
}

// Start launches the Modbus Slave server according to config.
func (s *ModbusSlaveServer) Start(config SlaveConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isListening {
		s.stopListenersLocked() // a restart keeps a running simulation
	}

	s.config = config
	slaveID := config.SlaveID
	if slaveID == 0 {
		slaveID = 1
	}

	// Keep memory edited by the user before starting; only the unit ID changes.
	if s.store == nil {
		s.store = NewSlaveMemoryStore(s.sessionID, slaveID, s.onActivity)
	} else {
		s.store.setSlaveID(slaveID)
	}
	s.config.SlaveID = slaveID
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
		s.tcpConns = make(map[net.Conn]struct{})
		s.isListening = true

		go s.runRTUOverTCPLoop(ln, s.store, slaveID)

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
		// A short read timeout lets the framer detect the inter-frame silence (t3.5).
		if err := sp.SetReadTimeout(rtuSilence(baud)); err != nil {
			_ = sp.Close()
			return fmt.Errorf("failed to configure serial port %s: %w", portName, err)
		}
		s.serialPort = sp
		s.isListening = true

		go s.handleRTUConnection(&serialFrameReader{sp}, s.store, slaveID, "Serial "+config.Port)

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
	s.stopListenersLocked()
}

// stopListenersLocked closes the TCP/serial listeners and connections, leaving any simulation.
func (s *ModbusSlaveServer) stopListenersLocked() {

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

	for conn := range s.tcpConns {
		_ = conn.Close()
	}
	s.tcpConns = nil

	if s.serialPort != nil {
		_ = s.serialPort.Close()
		s.serialPort = nil
	}

	s.isListening = false
}

// rtuSilence returns the RTU inter-frame gap (3.5 characters, 1.75ms above 19200 baud per spec),
// padded to tolerate USB-serial adapter latency.
func rtuSilence(baud int) time.Duration {
	if baud <= 0 {
		baud = 9600
	}
	t35 := time.Duration(float64(time.Second) * 11 * 3.5 / float64(baud))
	if baud > 19200 {
		t35 = 1750 * time.Microsecond
	}
	return t35 + 20*time.Millisecond
}

// frameReader reads bytes; timedOut reports whether a read ended because the line went silent.
type frameReader interface {
	io.Writer
	ReadChunk(p []byte) (n int, timedOut bool, err error)
}

type serialFrameReader struct{ sp serial.Port }

func (r *serialFrameReader) ReadChunk(p []byte) (int, bool, error) {
	n, err := r.sp.Read(p)
	// go.bug.st/serial returns (0, nil) when the read timeout expires.
	return n, n == 0 && err == nil, err
}

func (r *serialFrameReader) Write(p []byte) (int, error) { return r.sp.Write(p) }

type tcpFrameReader struct {
	conn    net.Conn
	pending bool // a partial frame is buffered, so silence must be detected
	silence time.Duration
}

func (r *tcpFrameReader) ReadChunk(p []byte) (int, bool, error) {
	if r.pending {
		_ = r.conn.SetReadDeadline(time.Now().Add(r.silence))
	} else {
		_ = r.conn.SetReadDeadline(time.Time{})
	}
	n, err := r.conn.Read(p)
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return n, true, nil
	}
	return n, false, err
}

func (r *tcpFrameReader) Write(p []byte) (int, error) { return r.conn.Write(p) }

// RTU over TCP server listener loop
func (s *ModbusSlaveServer) runRTUOverTCPLoop(ln net.Listener, store *SlaveMemoryStore, slaveID uint8) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}

		s.mu.Lock()
		if s.tcpConns == nil || s.tcpListener != ln {
			s.mu.Unlock()
			_ = conn.Close()
			return
		}
		s.tcpConns[conn] = struct{}{}
		s.mu.Unlock()

		go func(c net.Conn) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[RTU-TCP] Recovered from panic: %v", r)
				}
				s.mu.Lock()
				delete(s.tcpConns, c)
				s.mu.Unlock()
				_ = c.Close()
			}()
			r := &tcpFrameReader{conn: c, silence: 100 * time.Millisecond}
			s.handleRTUConnection(r, store, slaveID, c.RemoteAddr().String())
		}(conn)
	}
}

// expectedRequestLen returns the full length (including CRC) of the RTU request at the start
// of buf, 0 if more bytes are needed to know, or -1 if the function code has no fixed layout.
func expectedRequestLen(buf []byte) int {
	if len(buf) < 2 {
		return 0
	}
	switch buf[1] {
	case 0x01, 0x02, 0x03, 0x04, 0x05, 0x06:
		return 8
	case 0x0F, 0x10:
		if len(buf) < 7 {
			return 0
		}
		byteCount := int(buf[6])
		if byteCount > 250 {
			return -1 // Unreasonable byte count: drop / resync
		}
		return 9 + byteCount
	default:
		return -1
	}
}

// handleRTUConnection reassembles RTU frames from a byte stream. A frame is complete when its
// expected length is reached; bytes left dangling after a line silence are discarded.
// slaveID is fixed when the listener starts, so frame handling never reads s.config (which a
// concurrent Start may be rewriting).
func (s *ModbusSlaveServer) handleRTUConnection(rw frameReader, store *SlaveMemoryStore, slaveID uint8, clientAddr string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RTU] Recovered from panic in handleRTUConnection (%s): %v", clientAddr, r)
		}
	}()

	readBuf := make([]byte, 512)
	var pending []byte
	lastDataTime := time.Now()

	for {
		if tr, ok := rw.(*tcpFrameReader); ok {
			tr.pending = len(pending) > 0
		}

		n, timedOut, err := rw.ReadChunk(readBuf)
		if err != nil {
			return
		}

		if n > 0 {
			pending = append(pending, readBuf[:n]...)
			lastDataTime = time.Now()
		}

		for len(pending) > 0 {
			want := expectedRequestLen(pending)
			if want == 0 || (want > 0 && len(pending) < want) {
				break // wait for more bytes
			}
			if want < 0 {
				// Unknown layout: only process if there was a silence
				if !timedOut || n > 0 {
					break
				}
				want = len(pending)
			}

			frame := pending[:want]
			if len(frame) >= 4 && binary.LittleEndian.Uint16(frame[want-2:]) == CRC16Modbus(frame[:want-2]) {
				if resp := s.processRTUFrame(store, slaveID, frame, clientAddr); len(resp) > 0 {
					_, _ = rw.Write(resp)
				}
				pending = pending[want:]
			} else {
				// Bad CRC: drop one byte and try to resynchronise on the next frame start.
				pending = pending[1:]
			}
		}

		// Only discard incomplete pending buffer if a genuine silence period elapsed
		// without receiving any new bytes (n == 0 && timedOut).
		// We allow at least 150ms of silence before discarding dangling partial frames.
		if timedOut && n == 0 && len(pending) > 0 && time.Since(lastDataTime) >= 150*time.Millisecond {
			pending = pending[:0]
		}
		if len(pending) > 1024 {
			pending = pending[:0]
		}
	}
}

// processRTUFrame handles a CRC-validated RTU request (FC 01-06, 0F, 10) and returns the response
// bytes, or nil when no response must be sent (other unit IDs, broadcast).
func (s *ModbusSlaveServer) processRTUFrame(store *SlaveMemoryStore, slaveID uint8, frame []byte, clientAddr string) []byte {
	unitID := frame[0]
	if unitID != 0 && unitID != slaveID {
		return nil // addressed to another device on the bus: stay silent
	}
	broadcast := unitID == 0

	fc := frame[1]
	reply := func(resp []byte) []byte {
		if broadcast {
			return nil // broadcast requests are never answered
		}
		return resp
	}
	exception := func(code byte) []byte {
		return reply(s.buildExceptionResponse(unitID, fc, code))
	}

	switch fc {
	case 0x01, 0x02: // Read Coils / Discrete Inputs
		if broadcast {
			return nil
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		if qty < 1 || qty > 2000 {
			return exception(0x03)
		}
		var bools []bool
		var err error
		if fc == 0x01 {
			bools, err = store.HandleCoils(&simonmodbus.CoilsRequest{
				ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			})
		} else {
			bools, err = store.HandleDiscreteInputs(&simonmodbus.DiscreteInputsRequest{
				ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			})
		}
		if err != nil {
			return exception(0x02)
		}
		return s.buildBitReadResponse(unitID, fc, bools)

	case 0x03, 0x04: // Read Holding / Input Registers
		if broadcast {
			return nil
		}
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		if qty < 1 || qty > 125 {
			return exception(0x03)
		}
		var regs []uint16
		var err error
		if fc == 0x03 {
			regs, err = store.HandleHoldingRegisters(&simonmodbus.HoldingRegistersRequest{
				ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			})
		} else {
			regs, err = store.HandleInputRegisters(&simonmodbus.InputRegistersRequest{
				ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			})
		}
		if err != nil {
			return exception(0x02)
		}
		return s.buildRegisterReadResponse(unitID, fc, regs)

	case 0x05: // Write Single Coil
		addr := binary.BigEndian.Uint16(frame[2:4])
		rawVal := binary.BigEndian.Uint16(frame[4:6])
		if rawVal != 0xFF00 && rawVal != 0x0000 {
			return exception(0x03)
		}
		if _, err := store.HandleCoils(&simonmodbus.CoilsRequest{
			ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: 1,
			IsWrite: true, Args: []bool{rawVal == 0xFF00},
		}); err != nil {
			return exception(0x02)
		}
		return reply(append([]byte(nil), frame[:8]...)) // echo request

	case 0x06: // Write Single Register
		addr := binary.BigEndian.Uint16(frame[2:4])
		val := binary.BigEndian.Uint16(frame[4:6])
		if _, err := store.HandleHoldingRegisters(&simonmodbus.HoldingRegistersRequest{
			ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: 1,
			IsWrite: true, Args: []uint16{val},
		}); err != nil {
			return exception(0x02)
		}
		return reply(append([]byte(nil), frame[:8]...)) // echo request

	case 0x0F: // Write Multiple Coils
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		byteCount := int(frame[6])
		if qty < 1 || qty > 1968 || byteCount != (int(qty)+7)/8 {
			return exception(0x03)
		}
		bools := make([]bool, qty)
		for i := range bools {
			bools[i] = frame[7+i/8]&(1<<(i%8)) != 0
		}
		if _, err := store.HandleCoils(&simonmodbus.CoilsRequest{
			ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			IsWrite: true, Args: bools,
		}); err != nil {
			return exception(0x02)
		}
		return reply(s.buildWriteMultipleResponse(unitID, fc, addr, qty))

	case 0x10: // Write Multiple Registers
		addr := binary.BigEndian.Uint16(frame[2:4])
		qty := binary.BigEndian.Uint16(frame[4:6])
		byteCount := int(frame[6])
		if qty < 1 || qty > 123 || byteCount != int(qty)*2 {
			return exception(0x03)
		}
		regs := make([]uint16, qty)
		for i := range regs {
			regs[i] = binary.BigEndian.Uint16(frame[7+i*2:])
		}
		if _, err := store.HandleHoldingRegisters(&simonmodbus.HoldingRegistersRequest{
			ClientAddr: clientAddr, UnitId: unitID, Addr: addr, Quantity: qty,
			IsWrite: true, Args: regs,
		}); err != nil {
			return exception(0x02)
		}
		return reply(s.buildWriteMultipleResponse(unitID, fc, addr, qty))

	default:
		// Unsupported function code -> Exception 0x01 (Illegal Function)
		return exception(0x01)
	}
}

func (s *ModbusSlaveServer) buildWriteMultipleResponse(unitID, fc uint8, addr, qty uint16) []byte {
	resp := make([]byte, 8)
	resp[0] = unitID
	resp[1] = fc
	binary.BigEndian.PutUint16(resp[2:], addr)
	binary.BigEndian.PutUint16(resp[4:], qty)
	binary.LittleEndian.PutUint16(resp[6:], CRC16Modbus(resp[:6]))
	return resp
}

func (s *ModbusSlaveServer) buildBitReadResponse(unitID uint8, fc uint8, bools []bool) []byte {
	if len(bools) > 2000 {
		return s.buildExceptionResponse(unitID, fc, 0x03)
	}
	byteCount := (len(bools) + 7) / 8
	resp := make([]byte, 3+byteCount+2)
	resp[0] = unitID
	resp[1] = fc
	resp[2] = byte(byteCount)

	for i, b := range bools {
		if b {
			resp[3+(i/8)] |= (1 << (i % 8))
		}
	}

	crc := CRC16Modbus(resp[:3+byteCount])
	binary.LittleEndian.PutUint16(resp[3+byteCount:], crc)
	return resp
}

func (s *ModbusSlaveServer) buildRegisterReadResponse(unitID uint8, fc uint8, regs []uint16) []byte {
	if len(regs) > 125 {
		return s.buildExceptionResponse(unitID, fc, 0x03)
	}
	byteCount := len(regs) * 2
	resp := make([]byte, 3+byteCount+2)
	resp[0] = unitID
	resp[1] = fc
	resp[2] = byte(byteCount)

	for i, reg := range regs {
		binary.BigEndian.PutUint16(resp[3+(i*2):], reg)
	}

	crc := CRC16Modbus(resp[:3+byteCount])
	binary.LittleEndian.PutUint16(resp[3+byteCount:], crc)
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

	if s.store == nil {
		s.store = NewSlaveMemoryStore(s.sessionID, 1, s.onActivity)
	}
	store := s.store

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
					store.ToggleCoil(cfg.Table, cfg.Address)
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
				store.SetRegister(cfg.Table, cfg.Address, uint16(math.Round(currentVal)))
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
