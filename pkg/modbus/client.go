package modbus

import (
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
	simTick      uint64

	// Metrics
	txCount  uint64
	errCount uint64
}

// NewModbusClientWrapper creates an uninitialized Modbus manager.
func NewModbusClientWrapper() *ModbusClientWrapper {
	return &ModbusClientWrapper{
		simRegisters: make(map[uint16]uint16),
		simCoils:     make(map[uint16]bool),
	}
}

// ListSerialPorts returns all physical or virtual COM ports available on the host OS.
func (m *ModbusClientWrapper) ListSerialPorts() []SerialPortDetail {
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

func (m *ModbusClientWrapper) formatPortName(port string) string {
	p := strings.TrimSpace(port)
	if idx := strings.Index(p, " "); idx != -1 {
		p = p[:idx]
	}
	p = strings.TrimSpace(p)

	if strings.HasPrefix(strings.ToUpper(p), "COM") {
		if !strings.HasPrefix(p, `\\.\`) {
			return `\\.\` + strings.ToUpper(p)
		}
	}
	return p
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
		formattedPort := m.formatPortName(config.Port)
		clientURL = fmt.Sprintf("rtu://%s", formattedPort)

		var parity uint = simonmodbus.PARITY_NONE
		switch strings.ToLower(config.Parity) {
		case "even":
			parity = simonmodbus.PARITY_EVEN
		case "odd":
			parity = simonmodbus.PARITY_ODD
		}

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
	m.isSimulator = false
	m.isConnected = true
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

	rawTx := FormatHex(BuildRTUReadRequest(def.SlaveID, def.FunctionCode, def.StartAddress, def.Quantity))
	isCoil := def.FunctionCode == 1 || def.FunctionCode == 2

	if !m.isConnected {
		return PollResult{
			Timestamp: timestamp,
			TxCount:   tx,
			ErrCount:  errCount,
			LatencyMs: 0,
			Error:     "Not connected to device",
			RawTx:     rawTx,
		}
	}

	// 1. Simulation Handler
	if m.isSimulator {
		m.simTick++
		noise := int16(m.simTick%7) - 3
		v := uint16(2205 + noise)
		m.simRegisters[0] = v
		m.simRegisters[1] = uint16(510 + (m.simTick % 6))
		m.simRegisters[2] = uint16(1120 + noise*5)
		m.simRegisters[3] = 98
		m.simRegisters[4] = uint16(5000 + (m.simTick % 4))
		m.simRegisters[5] = uint16(45 + (m.simTick % 3))
		m.simRegisters[6] = 200
		m.simRegisters[7] = uint16(m.simTick % 65535)

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

	// 2. Hardware Live Client
	m.client.SetUnitId(def.SlaveID)

	var regVals []uint16
	var coilVals []bool
	var readErr error

	switch def.FunctionCode {
	case 1:
		coilVals, readErr = m.client.ReadCoils(def.StartAddress, def.Quantity)
	case 2:
		coilVals, readErr = m.client.ReadDiscreteInputs(def.StartAddress, def.Quantity)
	case 3:
		regVals, readErr = m.client.ReadRegisters(def.StartAddress, def.Quantity, simonmodbus.HOLDING_REGISTER)
	case 4:
		regVals, readErr = m.client.ReadRegisters(def.StartAddress, def.Quantity, simonmodbus.INPUT_REGISTER)
	default:
		readErr = fmt.Errorf("unsupported function code: %d", def.FunctionCode)
	}

	latency := uint64(time.Since(startTime).Milliseconds())

	if readErr != nil {
		errCount = atomic.AddUint64(&m.errCount, 1)
		return PollResult{
			Timestamp: timestamp,
			IsCoil:    isCoil,
			TxCount:   tx,
			ErrCount:  errCount,
			LatencyMs: latency,
			Error:     readErr.Error(),
			RawTx:     rawTx,
		}
	}

	var rawRx string
	if isCoil {
		rawRx = FormatHex(BuildRTUCoilResponse(def.SlaveID, def.FunctionCode, coilVals))
	} else {
		rawRx = FormatHex(BuildRTURegisterResponse(def.SlaveID, def.FunctionCode, regVals))
	}

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
		return nil
	}

	m.client.SetUnitId(param.SlaveID)
	return m.client.WriteRegister(param.Address, param.Value)
}

// WriteRegisters writes multiple 16-bit registers (FC 16).
func (m *ModbusClientWrapper) WriteRegisters(param WriteRegistersParam) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isConnected {
		return fmt.Errorf("not connected to device")
	}

	if m.isSimulator {
		for i, v := range param.Values {
			m.simRegisters[param.Address+uint16(i)] = v
		}
		return nil
	}

	m.client.SetUnitId(param.SlaveID)
	return m.client.WriteRegisters(param.Address, param.Values)
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

	m.client.SetUnitId(param.SlaveID)
	return m.client.WriteCoil(param.Address, param.Value)
}
