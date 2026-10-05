// Package sniffer contains transport-independent Modbus capture, decoding and health analysis.
package sniffer

import "time"

type Transport string

const (
	TransportRTU Transport = "rtu"
	TransportTCP Transport = "tcp"
)

type CaptureMode string

const (
	ModeInternal      CaptureMode = "internal"
	ModeTCPProxy      CaptureMode = "tcp_proxy"
	ModeRTUOverTCP    CaptureMode = "rtu_over_tcp_proxy"
	ModePassiveSerial CaptureMode = "passive_serial"
	ModePassivePCAP   CaptureMode = "passive_pcap"
)

type Direction string

const (
	DirectionMasterToSlave Direction = "master_to_slave"
	DirectionSlaveToMaster Direction = "slave_to_master"
	DirectionUnknown       Direction = "unknown"
)

type CaptureQuality string

const (
	QualityWire          CaptureQuality = "wire"
	QualityReconstructed CaptureQuality = "reconstructed"
	QualityPartial       CaptureQuality = "partial"
)

type DiagnosticItem struct {
	RuleID         string `json:"rule_id"`
	Severity       string `json:"severity"`
	Scope          string `json:"scope,omitempty"`
	Message        string `json:"message"`
	Recommendation string `json:"recommendation,omitempty"`
	Confidence     int    `json:"confidence"`
}

type DecodedModbus struct {
	UnitID            uint8              `json:"unit_id"`
	TransactionID     *uint16            `json:"transaction_id,omitempty"`
	FunctionCode      uint8              `json:"function_code"`
	FunctionName      string             `json:"function_name"`
	Kind              string             `json:"kind"` // request, response, exception, unknown
	Address           *uint16            `json:"address,omitempty"`
	Quantity          *uint16            `json:"quantity,omitempty"`
	Values            []uint16           `json:"values,omitempty"`
	Bits              []bool             `json:"bits,omitempty"`
	ExceptionCode     *uint8             `json:"exception_code,omitempty"`
	ExceptionName     string             `json:"exception_name,omitempty"`
	CRCValid          *bool              `json:"crc_valid,omitempty"`
	MBAPValid         *bool              `json:"mbap_valid,omitempty"`
	Summary           string             `json:"summary"`
	SubFunction       *uint16            `json:"sub_function,omitempty"`
	WriteAddress      *uint16            `json:"write_address,omitempty"`
	WriteQuantity     *uint16            `json:"write_quantity,omitempty"`
	WriteValues       []uint16           `json:"write_values,omitempty"`
	AndMask           *uint16            `json:"and_mask,omitempty"`
	OrMask            *uint16            `json:"or_mask,omitempty"`
	TextData          string             `json:"text_data,omitempty"`
	EngineeringValues []EngineeringValue `json:"engineering_values,omitempty"`
}

type CapturedFrame struct {
	ID               string           `json:"id"`
	Sequence         uint64           `json:"sequence"`
	CapturedAtUnixNS int64            `json:"captured_at_unix_ns"`
	Timestamp        string           `json:"timestamp"`
	SourceID         string           `json:"source_id"`
	Transport        Transport        `json:"transport"`
	Direction        Direction        `json:"direction"`
	CaptureSource    string           `json:"capture_source"`
	CaptureQuality   CaptureQuality   `json:"capture_quality"`
	Raw              []byte           `json:"raw"`
	Hex              string           `json:"hex"`
	Parsed           *DecodedModbus   `json:"parsed,omitempty"`
	ConversationID   string           `json:"conversation_id,omitempty"`
	ResponseTimeUS   uint64           `json:"response_time_us,omitempty"`
	Diagnostics      []DiagnosticItem `json:"diagnostics,omitempty"`
}

type DeviceHealth struct {
	UnitID           uint8   `json:"unit_id"`
	State            string  `json:"state"`
	Requests         uint64  `json:"requests"`
	Responses        uint64  `json:"responses"`
	Exceptions       uint64  `json:"exceptions"`
	Timeouts         uint64  `json:"timeouts"`
	Retries          uint64  `json:"retries"`
	SuccessRate      float64 `json:"success_rate"`
	AverageLatencyUS uint64  `json:"average_latency_us"`
	P95LatencyUS     uint64  `json:"p95_latency_us"`
	LastRequestAt    string  `json:"last_request_at,omitempty"`
	LastResponseAt   string  `json:"last_response_at,omitempty"`
}

type HealthSnapshot struct {
	Score            int            `json:"score"`
	State            string         `json:"state"`
	TotalFrames      uint64         `json:"total_frames"`
	Requests         uint64         `json:"requests"`
	Responses        uint64         `json:"responses"`
	Exceptions       uint64         `json:"exceptions"`
	Timeouts         uint64         `json:"timeouts"`
	Retries          uint64         `json:"retries"`
	MalformedFrames  uint64         `json:"malformed_frames"`
	CRCErrorFrames   uint64         `json:"crc_error_frames"`
	OrphanResponses  uint64         `json:"orphan_responses"`
	PendingRequests  int            `json:"pending_requests"`
	AverageLatencyUS uint64         `json:"average_latency_us"`
	P95LatencyUS     uint64         `json:"p95_latency_us"`
	Devices          []DeviceHealth `json:"devices"`
}

type BaselineMode string

const (
	BaselineModeOff     BaselineMode = "off"
	BaselineModeLearn   BaselineMode = "learn"
	BaselineModeMonitor BaselineMode = "monitor"
)

type DeviceBaseline struct {
	UnitID                uint8   `json:"unit_id"`
	SampleCount           uint64  `json:"sample_count"`
	MedianPollIntervalMS  float64 `json:"median_poll_interval_ms"`
	P50LatencyUS          uint64  `json:"p50_latency_us"`
	P95LatencyUS          uint64  `json:"p95_latency_us"`
	ObservedFunctionCodes []uint8 `json:"observed_function_codes"`
}

type BaselineProfile struct {
	Mode         BaselineMode              `json:"mode"`
	LearnedAt    string                    `json:"learned_at,omitempty"`
	SampleFrames uint64                    `json:"sample_frames"`
	Devices      map[uint8]*DeviceBaseline `json:"devices"`
}

type Snapshot struct {
	GeneratedAt string          `json:"generated_at"`
	Frames      []CapturedFrame `json:"frames"`
	Health      HealthSnapshot  `json:"health"`
	Baseline    BaselineProfile `json:"baseline"`
}

type CaptureConfig struct {
	Mode          CaptureMode `json:"mode"`
	ListenHost    string      `json:"listen_host,omitempty"`
	ListenPort    uint16      `json:"listen_port,omitempty"`
	TargetHost    string      `json:"target_host,omitempty"`
	TargetPort    uint16      `json:"target_port,omitempty"`
	SerialPort    string      `json:"serial_port,omitempty"`
	BaudRate      int         `json:"baud_rate,omitempty"`
	DataBits      int         `json:"data_bits,omitempty"`
	Parity        string      `json:"parity,omitempty"`
	StopBits      int         `json:"stop_bits,omitempty"`
	InterfaceName string      `json:"interface_name,omitempty"`
	BPFFilter     string      `json:"bpf_filter,omitempty"`
}

type CaptureStatus struct {
	Running           bool        `json:"running"`
	Mode              CaptureMode `json:"mode"`
	StartedAt         string      `json:"started_at,omitempty"`
	ListenAddress     string      `json:"listen_address,omitempty"`
	TargetAddress     string      `json:"target_address,omitempty"`
	ActiveConnections int         `json:"active_connections"`
	BytesCaptured     uint64      `json:"bytes_captured"`
	DroppedChunks     uint64      `json:"dropped_chunks"`
	// DroppedFrames counts frames forwarded on the wire but skipped by the analyzer because its
	// queue was full; the proxy itself never drops or delays data.
	DroppedFrames uint64 `json:"dropped_frames"`
	// TCP holds stream statistics of a passive network capture.
	TCP       *TCPStreamStats `json:"tcp,omitempty"`
	LastError string          `json:"last_error,omitempty"`
}

type CaptureFile struct {
	SchemaVersion int              `json:"schema_version"`
	CreatedAt     string           `json:"created_at"`
	App           string           `json:"app"`
	Frames        []CapturedFrame  `json:"frames"`
	Baseline      *BaselineProfile `json:"baseline,omitempty"`
	Profile       *ProfileCatalog  `json:"profile,omitempty"`
}

type pendingRequest struct {
	frameID string
	convID  string
	seq     uint64
	when    time.Time
	unitID  uint8
	fc      uint8
	address *uint16
	pdu     []byte // request PDU, to recognise byte-for-byte echo responses (FC05/06/08/22)
}
