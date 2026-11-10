package modbus

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
	"go.bug.st/serial/enumerator"
)

// ModbusClientWrapper manages both live hardware Modbus connections (Serial/TCP) and virtual simulation.
type ModbusClientWrapper struct {
	mu           sync.Mutex
	client       *simonmodbus.ModbusClient
	isSimulator  bool
	isConnected  bool
	activeConfig *ConnectionConfig

	// Virtual simulator state
	simRegisters map[uint16]uint16
	simCoils     map[uint16]bool
	simOverrides map[uint16]bool
	simTick      uint64

	// clientConfig is the configuration of the live client; timeout is its current request
	// timeout, which the Slave ID scanner may temporarily override.
	clientConfig  simonmodbus.ClientConfiguration
	baseTimeout   time.Duration
	lastProbeTime time.Time
	// probing is set during Slave ID scanner probes: absent IDs time out by design, so their
	// timeouts must not be taken as a dead TCP link.
	probing bool

	// txnID mirrors the library's Modbus TCP transaction counter (reset on every Open) so the
	// traffic sniffer can show the real MBAP header.
	txnID uint16

	// Link health: after an I/O error the connection is reopened on the next request.
	needsReopen    bool
	consecTimeouts int
	lastReopenTry  time.Time

	// Metrics
	txCount  uint64
	errCount uint64
}

// NewModbusClientWrapper creates an uninitialized Modbus manager.
func NewModbusClientWrapper() *ModbusClientWrapper {
	return &ModbusClientWrapper{
		simRegisters: make(map[uint16]uint16),
		simCoils:     make(map[uint16]bool),
		simOverrides: make(map[uint16]bool),
	}
}

// ListSerialPorts returns all physical or virtual COM ports available on the host OS.
func ListSerialPorts() []SerialPortDetail {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return []SerialPortDetail{
			{PortName: "COM1", Description: "Standard Serial Port"},
		}
	}

	var results []SerialPortDetail
	for _, p := range ports {
		desc := p.Name
		if p.Product != "" {
			desc = fmt.Sprintf("%s (%s)", p.Product, p.Name)
		}
		hwID := ""
		if p.VID != "" && p.PID != "" {
			hwID = fmt.Sprintf("VID_%s&PID_%s", p.VID, p.PID)
		}
		results = append(results, SerialPortDetail{
			PortName:    p.Name,
			Description: desc,
			HardwareID:  hwID,
		})
	}

	if len(results) == 0 {
		results = append(results, SerialPortDetail{
			PortName:    "COM1",
			Description: "Standard Serial Port",
		})
	}
	return results
}

// Connect establishes a Modbus connection to Serial RTU, TCP, or the built-in simulator.
func (m *ModbusClientWrapper) Connect(config ConnectionConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Disconnect existing if any
	m.disconnectLocked()

	// 1. Virtual Simulator Mode
	portLower := strings.ToLower(config.Port)
	hostLower := strings.ToLower(config.Host)
	if portLower == "simulator" || portLower == "sim" || hostLower == "simulator" || hostLower == "sim" {
		m.isSimulator = true
		m.isConnected = true
		m.activeConfig = &config
		atomic.StoreUint64(&m.txCount, 0)
		atomic.StoreUint64(&m.errCount, 0)

		// Seed initial simulator values
		m.simRegisters = map[uint16]uint16{
			0: 2205, // 220.5 V
			1: 512,  // 5.12 A
			2: 1128, // 1128 W
			3: 98,   // 0.98 PF
			4: 5001, // 50.01 Hz
			5: 45,   // 45 °C
			6: 200,
			7: 0,
		}
		m.simCoils = map[uint16]bool{
			0: true,
			1: false,
			2: true,
		}
		m.simOverrides = make(map[uint16]bool)
		m.simTick = 0

		return "Connected to Virtual Simulator", nil
	}

	timeout := time.Duration(config.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 1000 * time.Millisecond
	}

	// 2. Serial RTU or TCP
	var clientURL string
	var clientConfig simonmodbus.ClientConfiguration

	if config.Type == "tcp" {
		if config.Host == "" {
			return "", fmt.Errorf("TCP host cannot be empty")
		}
		port := config.TcpPort
		if port == 0 {
			port = 502
		}
		clientURL = fmt.Sprintf("tcp://%s:%d", config.Host, port)
		clientConfig = simonmodbus.ClientConfiguration{
			URL:     clientURL,
			Timeout: timeout,
		}
	} else if config.Type == "rtu_over_tcp" || config.Type == "rtuovertcp" {
		if config.Host == "" {
			return "", fmt.Errorf("Host cannot be empty")
		}
		port := config.TcpPort
		if port == 0 {
			port = 502
		}
		clientURL = fmt.Sprintf("rtuovertcp://%s:%d", config.Host, port)
		clientConfig = simonmodbus.ClientConfiguration{
			URL:     clientURL,
			Timeout: timeout,
		}
	} else {
		// Serial RTU
		if config.Port == "" {
			return "", fmt.Errorf("Serial port cannot be empty")
		}
		formattedPort := normalizeSerialPort(config.Port)
		clientURL = fmt.Sprintf("rtu://%s", formattedPort)

		parity := libParity(config.Parity)

		baud := config.BaudRate
		if baud == 0 {
			baud = 9600
		}
		dataBits := config.DataBits
		if dataBits == 0 {
			dataBits = 8
		}
		stopBits := config.StopBits
		if stopBits == 0 {
			stopBits = 1
		}

		clientConfig = simonmodbus.ClientConfiguration{
			URL:      clientURL,
			Speed:    baud,
			DataBits: dataBits,
			Parity:   parity,
			StopBits: stopBits,
			Timeout:  timeout,
		}
	}

	client, err := simonmodbus.NewClient(&clientConfig)
	if err != nil {
		return "", fmt.Errorf("failed to create modbus client: %w", err)
	}

	if err := client.Open(); err != nil {
		return "", fmt.Errorf("failed to open modbus connection on %s: %w", clientURL, err)
	}

	m.client = client
	m.txnID = 0
	m.clientConfig = clientConfig
	m.baseTimeout = clientConfig.Timeout
	m.isSimulator = false
	m.isConnected = true
	m.needsReopen = false
	m.consecTimeouts = 0
	m.activeConfig = &config
	atomic.StoreUint64(&m.txCount, 0)
	atomic.StoreUint64(&m.errCount, 0)

	return fmt.Sprintf("Connected to %s", clientURL), nil
}

// Disconnect terminates the active connection.
func (m *ModbusClientWrapper) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disconnectLocked()
}

func (m *ModbusClientWrapper) disconnectLocked() {
	if m.client != nil {
		_ = m.client.Close()
		m.client = nil
	}
	m.isConnected = false
	m.isSimulator = false
	m.activeConfig = nil
}

// tcpTimeoutsBeforeReopen is how many consecutive timeouts on a TCP link are treated as a dead
// socket (e.g. a gateway that rebooted without closing the connection).
const tcpTimeoutsBeforeReopen = 3

// reopenInterval limits reconnect attempts so a missing device is not hammered every poll.
const reopenInterval = time.Second

func (m *ModbusClientWrapper) isTCPLinkLocked() bool {
	if m.activeConfig == nil {
		return false
	}
	switch m.activeConfig.Type {
	case "tcp", "rtu_over_tcp", "rtuovertcp":
		return true
	}
	return false
}

// scanTimeoutHold is how long after the last scanner probe the scan timeout stays active, so
// polls interleaved with a running scan do not reopen the port on every request.
var scanTimeoutHold = 2 * time.Second

// setTimeoutLocked reopens the live client with a different request timeout. The library has
// no way to change the timeout of an open client, so a new client is created on the same link.
func (m *ModbusClientWrapper) setTimeoutLocked(timeout time.Duration) error {
	if m.client == nil || timeout == m.clientConfig.Timeout {
		return nil
	}
	// A failed reopen leaves the old timeout in place; do not redial on every request.
	if m.needsReopen && time.Since(m.lastReopenTry) < reopenInterval {
		return fmt.Errorf("connection lost, reconnecting")
	}
	m.lastReopenTry = time.Now()
	cfg := m.clientConfig
	cfg.Timeout = timeout
	next, err := simonmodbus.NewClient(&cfg)
	if err != nil {
		return err
	}
	_ = m.client.Close()
	if err := next.Open(); err != nil {
		// Keep the old client object so ensureLinkLocked can retry on the next request.
		m.needsReopen = true
		return fmt.Errorf("failed to reopen link with %v timeout: %w", timeout, err)
	}
	m.client = next
	m.txnID = 0
	m.clientConfig = cfg
	m.needsReopen = false
	m.consecTimeouts = 0
	return nil
}

// ensureLinkLocked reopens the transport if a previous request failed with an I/O error, and
// restores the connection timeout once a Slave ID scan has finished.
func (m *ModbusClientWrapper) ensureLinkLocked() error {
	if m.clientConfig.Timeout != m.baseTimeout && time.Since(m.lastProbeTime) > scanTimeoutHold {
		if err := m.setTimeoutLocked(m.baseTimeout); err != nil {
			return err
		}
	}
	if !m.needsReopen {
		return nil
	}
	if time.Since(m.lastReopenTry) < reopenInterval {
		return fmt.Errorf("connection lost, reconnecting")
	}
	m.lastReopenTry = time.Now()
	_ = m.client.Close()
	if err := m.client.Open(); err != nil {
		return fmt.Errorf("connection lost, reconnect failed: %w", err)
	}
	m.txnID = 0
	m.needsReopen = false
	m.consecTimeouts = 0
	return nil
}

// noteResultLocked records the outcome of a request to decide whether the link must be reopened.
// Modbus exceptions and protocol errors mean the link works; raw I/O errors (reset socket,
// unplugged USB adapter) mean it does not.
func (m *ModbusClientWrapper) noteResultLocked(err error) {
	if err == nil {
		m.consecTimeouts = 0
		return
	}
	var mbErr simonmodbus.Error
	if errors.As(err, &mbErr) {
		if mbErr == simonmodbus.ErrProtocolError || mbErr == simonmodbus.ErrBadCRC || mbErr == simonmodbus.ErrShortFrame {
			// On serial RTU links, a protocol error or bad CRC often indicates misaligned UART buffer
			// (stale bytes from previous frames or framing mismatch). If it persists, reopen the link
			// to flush the hardware UART buffer.
			m.consecTimeouts++
			if m.consecTimeouts >= 2 {
				m.needsReopen = true
			}
			return
		}
		if mbErr != simonmodbus.ErrRequestTimedOut {
			// A Modbus exception (e.g. Illegal Data Address) is a valid response from the slave: the link is alive.
			m.consecTimeouts = 0
			return
		}
		if m.isTCPLinkLocked() && !m.probing {
			m.consecTimeouts++
			if m.consecTimeouts >= tcpTimeoutsBeforeReopen {
				m.needsReopen = true
			}
		}
		return
	}
	m.needsReopen = true
}

// hardwareCallLocked runs one request on the live client with reconnect handling.
func (m *ModbusClientWrapper) hardwareCallLocked(slaveID uint8, call func() error) error {
	if err := m.ensureLinkLocked(); err != nil {
		return err
	}
	m.client.SetUnitId(slaveID)
	err := call()
	// The library rejects bad parameters before sending; every other outcome sent a request.
	if !errors.Is(err, simonmodbus.ErrUnexpectedParameters) {
		m.txnID++
	}
	m.noteResultLocked(err)
	return err
}

// ResetCounters zeroes the TX/error counters reported with every poll result.
func (m *ModbusClientWrapper) ResetCounters() {
	atomic.StoreUint64(&m.txCount, 0)
	atomic.StoreUint64(&m.errCount, 0)
}

// IsConnected returns connection status.
func (m *ModbusClientWrapper) IsConnected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isConnected
}

// ExecuteRead executes a read operation and formats standard hex frames and metrics.
func (m *ModbusClientWrapper) ExecuteRead(def PollDefinition) PollResult {
	res := m.executeRead(def)
	res.SlaveID = def.SlaveID
	res.FunctionCode = def.FunctionCode
	res.StartAddress = def.StartAddress
	return res
}

func (m *ModbusClientWrapper) executeRead(def PollDefinition) PollResult {
	m.mu.Lock()
	defer m.mu.Unlock()

	startTime := time.Now()
	timestamp := time.Now().Format("15:04:05.000")
	tx := atomic.AddUint64(&m.txCount, 1)
	errCount := atomic.LoadUint64(&m.errCount)

	rtuRequest := BuildRTUReadRequest(def.SlaveID, def.FunctionCode, def.StartAddress, def.Quantity)
	rawTx := FormatHex(rtuRequest) // simulator frames are shown in RTU format
	isCoil := def.FunctionCode == 1 || def.FunctionCode == 2

	// Nothing is sent in these cases, so no TX frame is reported.
	if !m.isConnected {
		return PollResult{Timestamp: timestamp, TxCount: tx, ErrCount: errCount, Error: "Not connected to device"}
	}
	if err := def.Validate(); err != nil {
		errCount = atomic.AddUint64(&m.errCount, 1)
		return PollResult{Timestamp: timestamp, IsCoil: isCoil, TxCount: tx, ErrCount: errCount, Error: err.Error()}
	}

	// 1. Simulation Handler
	if m.isSimulator {
		m.simTick++
		noise := int16(m.simTick%7) - 3
		dynamicValues := map[uint16]uint16{
			0: uint16(2205 + noise),
			1: uint16(510 + (m.simTick % 6)),
			2: uint16(1120 + noise*5),
			3: 98,
			4: uint16(5000 + (m.simTick % 4)),
			5: uint16(45 + (m.simTick % 3)),
			6: 200,
			7: uint16(m.simTick % 65535),
		}
		for address, value := range dynamicValues {
			// A manual FC06/FC16 write must remain observable on the next read. Previously the
			// automatic demo waveform overwrote addresses 0..7 before that read occurred.
			if !m.simOverrides[address] {
				m.simRegisters[address] = value
			}
		}

		if isCoil {
			bits := make([]bool, def.Quantity)
			for i := uint16(0); i < def.Quantity; i++ {
				bits[i] = m.simCoils[def.StartAddress+i]
			}
			rawRx := FormatHex(BuildRTUCoilResponse(def.SlaveID, def.FunctionCode, bits))
			return PollResult{
				Timestamp:  timestamp,
				Values:     []uint16{},
				BoolValues: bits,
				IsCoil:     true,
				TxCount:    tx,
				ErrCount:   errCount,
				LatencyMs:  8,
				RawTx:      rawTx,
				RawRx:      rawRx,
			}
		}

		vals := make([]uint16, def.Quantity)
		for i := uint16(0); i < def.Quantity; i++ {
			addr := def.StartAddress + i
			if val, ok := m.simRegisters[addr]; ok {
				vals[i] = val
			} else {
				vals[i] = addr * 10
			}
		}
		rawRx := FormatHex(BuildRTURegisterResponse(def.SlaveID, def.FunctionCode, vals))
		return PollResult{
			Timestamp:  timestamp,
			Values:     vals,
			BoolValues: []bool{},
			IsCoil:     false,
			TxCount:    tx,
			ErrCount:   errCount,
			LatencyMs:  8,
			RawTx:      rawTx,
			RawRx:      rawRx,
		}
	}

	// 2. Hardware Live Client (with Smart Contiguous Sub-Block Splitting when DisabledAddrs or Quantity > 125)
	needsSplitting := len(def.DisabledAddrs) > 0 || (def.FunctionCode >= 3 && def.Quantity > 125)
	if needsSplitting {
		blocks := def.BuildSubBlocks()
		if len(blocks) == 0 {
			return PollResult{
				Timestamp:  timestamp,
				Values:     make([]uint16, def.Quantity),
				BoolValues: make([]bool, def.Quantity),
				IsCoil:     isCoil,
				TxCount:    tx,
				ErrCount:   errCount,
				LatencyMs:  0,
			}
		}

		fullRegs := make([]uint16, def.Quantity)
		fullCoils := make([]bool, def.Quantity)
		var txFrames, rxFrames []string
		var anySuccess bool
		var firstErr error
		isTCP := m.activeConfig != nil && m.activeConfig.Type == "tcp"

		for bIdx, blk := range blocks {
			var bRegs []uint16
			var bCoils []bool
			bReq := BuildRTUReadRequest(def.SlaveID, def.FunctionCode, blk.StartAddress, blk.Quantity)
			txnBefore := m.txnID
			bErr := m.hardwareCallLocked(def.SlaveID, func() (err error) {
				switch def.FunctionCode {
				case 1:
					bCoils, err = m.client.ReadCoils(blk.StartAddress, blk.Quantity)
				case 2:
					bCoils, err = m.client.ReadDiscreteInputs(blk.StartAddress, blk.Quantity)
				case 3:
					bRegs, err = m.client.ReadRegisters(blk.StartAddress, blk.Quantity, simonmodbus.HOLDING_REGISTER)
				case 4:
					bRegs, err = m.client.ReadRegisters(blk.StartAddress, blk.Quantity, simonmodbus.INPUT_REGISTER)
				}
				return err
			})
			sent := m.txnID != txnBefore
			if sent {
				txFrames = append(txFrames, FormatHex(wireFrame(bReq, isTCP, m.txnID)))
			}
			if bErr != nil {
				if firstErr == nil {
					firstErr = bErr
				}
				if exc := buildRTUExceptionResponse(def.SlaveID, def.FunctionCode, bErr); exc != nil && sent {
					rxFrames = append(rxFrames, FormatHex(wireFrame(exc, isTCP, m.txnID)))
				}
				// If the very first sub-block times out, the device is offline — abort early so we don't stall on remaining sub-blocks
				if bIdx == 0 && !anySuccess && errors.Is(bErr, simonmodbus.ErrRequestTimedOut) {
					break
				}
				continue
			}

			anySuccess = true
			if isCoil {
				for j, v := range bCoils {
					if int(blk.Offset)+j < int(def.Quantity) {
						fullCoils[int(blk.Offset)+j] = v
					}
				}
				bResp := BuildRTUCoilResponse(def.SlaveID, def.FunctionCode, bCoils)
				rxFrames = append(rxFrames, FormatHex(wireFrame(bResp, isTCP, m.txnID)))
			} else {
				for j, v := range bRegs {
					if int(blk.Offset)+j < int(def.Quantity) {
						fullRegs[int(blk.Offset)+j] = v
					}
				}
				bResp := BuildRTURegisterResponse(def.SlaveID, def.FunctionCode, bRegs)
				rxFrames = append(rxFrames, FormatHex(wireFrame(bResp, isTCP, m.txnID)))
			}
		}

		latency := uint64(time.Since(startTime).Milliseconds())
		joinedTx := strings.Join(txFrames, "  ||  ")
		joinedRx := strings.Join(rxFrames, "  ||  ")

		if !anySuccess && firstErr != nil {
			errCount = atomic.AddUint64(&m.errCount, 1)
			return PollResult{
				Timestamp: timestamp,
				IsCoil:    isCoil,
				TxCount:   tx,
				ErrCount:  errCount,
				LatencyMs: latency,
				Error:     firstErr.Error(),
				RawTx:     joinedTx,
				RawRx:     joinedRx,
			}
		}

		return PollResult{
			Timestamp:  timestamp,
			Values:     fullRegs,
			BoolValues: fullCoils,
			IsCoil:     isCoil,
			TxCount:    tx,
			ErrCount:   errCount,
			LatencyMs:  latency,
			RawTx:      joinedTx,
			RawRx:      joinedRx,
		}
	}

	// Standard Single-Block Hardware Live Client
	var regVals []uint16
	var coilVals []bool
	var readErr error

	txnBefore := m.txnID
	readErr = m.hardwareCallLocked(def.SlaveID, func() (err error) {
		switch def.FunctionCode {
		case 1:
			coilVals, err = m.client.ReadCoils(def.StartAddress, def.Quantity)
		case 2:
			coilVals, err = m.client.ReadDiscreteInputs(def.StartAddress, def.Quantity)
		case 3:
			regVals, err = m.client.ReadRegisters(def.StartAddress, def.Quantity, simonmodbus.HOLDING_REGISTER)
		case 4:
			regVals, err = m.client.ReadRegisters(def.StartAddress, def.Quantity, simonmodbus.INPUT_REGISTER)
		}
		return err
	})
	sent := m.txnID != txnBefore
	isTCP := m.activeConfig != nil && m.activeConfig.Type == "tcp"
	rawTx = ""
	if sent {
		rawTx = FormatHex(wireFrame(rtuRequest, isTCP, m.txnID))
	}

	latency := uint64(time.Since(startTime).Milliseconds())

	if readErr != nil {
		errCount = atomic.AddUint64(&m.errCount, 1)
		res := PollResult{
			Timestamp: timestamp,
			IsCoil:    isCoil,
			TxCount:   tx,
			ErrCount:  errCount,
			LatencyMs: latency,
			Error:     readErr.Error(),
			RawTx:     rawTx,
		}
		// A Modbus exception is a real response: show it. Timeouts/I/O errors received nothing.
		if exc := buildRTUExceptionResponse(def.SlaveID, def.FunctionCode, readErr); exc != nil && sent {
			res.RawRx = FormatHex(wireFrame(exc, isTCP, m.txnID))
		}
		return res
	}

	var rtuResponse []byte
	if isCoil {
		rtuResponse = BuildRTUCoilResponse(def.SlaveID, def.FunctionCode, coilVals)
	} else {
		rtuResponse = BuildRTURegisterResponse(def.SlaveID, def.FunctionCode, regVals)
	}
	rawRx := FormatHex(wireFrame(rtuResponse, isTCP, m.txnID))

	return PollResult{
		Timestamp:  timestamp,
		Values:     regVals,
		BoolValues: coilVals,
		IsCoil:     isCoil,
		TxCount:    tx,
		ErrCount:   errCount,
		LatencyMs:  latency,
		RawTx:      rawTx,
		RawRx:      rawRx,
	}
}

// WriteRegister writes a single 16-bit register (FC 06).
func (m *ModbusClientWrapper) WriteRegister(param WriteRegisterParam) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isConnected {
		return fmt.Errorf("not connected to device")
	}

	if m.isSimulator {
		m.simRegisters[param.Address] = param.Value
		m.simOverrides[param.Address] = true
		return nil
	}

	return m.hardwareCallLocked(param.SlaveID, func() error {
		return m.client.WriteRegister(param.Address, param.Value)
	})
}

// WriteRegisters writes multiple 16-bit registers (FC 16).
func (m *ModbusClientWrapper) WriteRegisters(param WriteRegistersParam) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isConnected {
		return fmt.Errorf("not connected to device")
	}
	if err := param.Validate(); err != nil {
		return err
	}

	if m.isSimulator {
		for i, v := range param.Values {
			address := param.Address + uint16(i)
			m.simRegisters[address] = v
			m.simOverrides[address] = true
		}
		return nil
	}

	return m.hardwareCallLocked(param.SlaveID, func() error {
		return m.client.WriteRegisters(param.Address, param.Values)
	})
}

// WriteCoil writes a single coil (FC 05).
func (m *ModbusClientWrapper) WriteCoil(param WriteCoilParam) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isConnected {
		return fmt.Errorf("not connected to device")
	}

	if m.isSimulator {
		m.simCoils[param.Address] = param.Value
		return nil
	}

	return m.hardwareCallLocked(param.SlaveID, func() error {
		return m.client.WriteCoil(param.Address, param.Value)
	})
}
