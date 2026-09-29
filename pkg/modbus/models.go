package modbus

import "fmt"

// SerialPortDetail contains information about an available serial COM port.
type SerialPortDetail struct {
	PortName    string `json:"port_name"`
	Description string `json:"description,omitempty"`
	HardwareID  string `json:"hardware_id,omitempty"`
}

// ConnectionConfig defines configuration for Modbus Serial RTU, TCP, or RTU over TCP connection.
type ConnectionConfig struct {
	Type      string `json:"type"` // "serial", "tcp", or "rtu_over_tcp"
	Port      string `json:"port,omitempty"`
	BaudRate  uint   `json:"baud_rate,omitempty"`
	DataBits  uint   `json:"data_bits,omitempty"`
	Parity    string `json:"parity,omitempty"` // "none", "even", "odd"
	StopBits  uint   `json:"stop_bits,omitempty"` // 1, 2
	Host      string `json:"host,omitempty"`
	TcpPort   uint16 `json:"port_tcp,omitempty"`
	TimeoutMs uint   `json:"timeout_ms"`
}

// PollDefinition defines what registers or coils to poll.
type PollDefinition struct {
	SlaveID      uint8  `json:"slave_id"`
	FunctionCode uint8  `json:"function_code"` // 1: Coils, 2: Discrete, 3: Holding, 4: Input
	StartAddress uint16 `json:"start_address"`
	Quantity     uint16 `json:"quantity"`
	ScanRateMs   uint64 `json:"scan_rate_ms"`
}

// PollResult represents the result of a single read cycle.
type PollResult struct {
	SessionID  string   `json:"session_id,omitempty"`
	Timestamp  string   `json:"timestamp"`
	// Request that produced this result, so the UI maps values to the right addresses even
	// if the poll definition was edited while the request was in flight.
	SlaveID      uint8  `json:"slave_id"`
	FunctionCode uint8  `json:"function_code"`
	StartAddress uint16 `json:"start_address"`
	Values     []uint16 `json:"values"`
	BoolValues []bool   `json:"bool_values"`
	IsCoil     bool     `json:"is_coil"`
	TxCount    uint64   `json:"tx_count"`
	ErrCount   uint64   `json:"err_count"`
	LatencyMs  uint64   `json:"latency_ms"`
	Error      string   `json:"error,omitempty"`
	RawTx      string   `json:"raw_tx,omitempty"`
	RawRx      string   `json:"raw_rx,omitempty"`
}

// WriteRegisterParam defines parameter for writing a single holding register (FC 06).
type WriteRegisterParam struct {
	SlaveID uint8  `json:"slave_id"`
	Address uint16 `json:"address"`
	Value   uint16 `json:"value"`
}

// WriteRegistersParam defines parameter for writing multiple holding registers (FC 16).
type WriteRegistersParam struct {
	SlaveID uint8    `json:"slave_id"`
	Address uint16   `json:"address"`
	Values  []uint16 `json:"values"`
}

// WriteCoilParam defines parameter for writing a single coil (FC 05).
type WriteCoilParam struct {
	SlaveID uint8  `json:"slave_id"`
	Address uint16 `json:"address"`
	Value   bool   `json:"value"`
}

// SlaveConfig defines configuration for running a Modbus Slave (Server Simulator).
type SlaveConfig struct {
	Type     string `json:"type"` // "tcp", "serial", "rtu_over_tcp"
	Host     string `json:"host,omitempty"`     // e.g. "0.0.0.0"
	TcpPort  uint16 `json:"port_tcp,omitempty"` // e.g. 502, 5020, 5502
	Port     string `json:"port,omitempty"`     // e.g. "COM2"
	BaudRate uint   `json:"baud_rate,omitempty"`
	DataBits uint   `json:"data_bits,omitempty"`
	Parity   string `json:"parity,omitempty"`
	StopBits uint   `json:"stop_bits,omitempty"`
	SlaveID  uint8  `json:"slave_id"` // 1-247
}

// SlaveActivityEvent represents a request/write event handled by the Slave server.
type SlaveActivityEvent struct {
	SessionID string   `json:"session_id"`
	Timestamp string   `json:"timestamp"`
	Client    string   `json:"client"`
	Function  string   `json:"function"`
	Address   uint16   `json:"address"`
	Quantity  uint16   `json:"quantity"`
	IsWrite   bool     `json:"is_write"`
	Values    []uint16 `json:"values,omitempty"`
	Bools     []bool   `json:"bools,omitempty"`
	Summary   string   `json:"summary"`
	HexRaw    string   `json:"hex_raw,omitempty"`
}

// SlaveMemorySlice represents a chunk of the slave's memory table returned to the frontend.
type SlaveMemorySlice struct {
	SessionID  string   `json:"session_id"`
	Table      string   `json:"table"` // "coils", "discrete", "input", "holding"
	StartAddr  uint16   `json:"start_address"`
	Quantity   uint16   `json:"quantity"`
	Values     []uint16 `json:"values,omitempty"`
	BoolValues []bool   `json:"bool_values,omitempty"`
}

// SimulationConfig specifies automatic value variation on a slave register.
type SimulationConfig struct {
	SessionID  string  `json:"session_id"`
	Table      string  `json:"table"`   // "holding", "input", "coils", "discrete"
	Address    uint16  `json:"address"`
	Mode       string  `json:"mode"`    // "increment", "random", "sine", "toggle"
	Min        float64 `json:"min"`
	Max        float64 `json:"max"`
	Step       float64 `json:"step"`
	IntervalMs uint64  `json:"interval_ms"`
}

// Validate checks a read request against the Modbus limits before it reaches a device or the
// simulator (which would otherwise wrap past address 65535 and label data wrongly).
func (d PollDefinition) Validate() error {
	maxQty := 125
	switch d.FunctionCode {
	case 1, 2:
		maxQty = 2000
	case 3, 4:
	default:
		return fmt.Errorf("unsupported function code: %d", d.FunctionCode)
	}
	if d.Quantity < 1 || int(d.Quantity) > maxQty {
		return fmt.Errorf("quantity %d out of range (1..%d for FC%02d)", d.Quantity, maxQty, d.FunctionCode)
	}
	if int(d.StartAddress)+int(d.Quantity) > 65536 {
		return fmt.Errorf("read range %d..%d exceeds address 65535", d.StartAddress, int(d.StartAddress)+int(d.Quantity)-1)
	}
	return nil
}
