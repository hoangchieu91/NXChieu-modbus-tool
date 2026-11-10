package rawserial

import (
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

// RawSerialFrame represents a directional frame of bytes observed or sent on the port.
type RawSerialFrame struct {
	Timestamp string `json:"timestamp"`
	Direction string `json:"direction"` // "rx" or "tx"
	Hex       string `json:"hex"`
	ASCII     string `json:"ascii"`
	Length    int    `json:"length"`
}

// Manager handles the lifecycle of a raw serial port connection and its async read loop.
type Manager struct {
	mu        sync.Mutex
	port      serial.Port
	portName  string
	baudRate  int
	stopChan  chan struct{}
	isOpen    bool
	onFrame   func(RawSerialFrame)
}

// NewManager creates an instance of raw serial manager.
func NewManager(onFrame func(RawSerialFrame)) *Manager {
	return &Manager{
		onFrame: onFrame,
	}
}

// normalizePort adds \\.\ prefix for Windows COM ports above COM9.
func normalizePort(p string) string {
	s := strings.TrimSpace(p)
	if idx := strings.Index(s, " "); idx != -1 {
		s = s[:idx]
	}
	if strings.HasPrefix(strings.ToUpper(s), "COM") && !strings.HasPrefix(s, `\\.\`) {
		return `\\.\` + strings.ToUpper(s)
	}
	return s
}

// Open establishes a raw connection to the serial port.
func (m *Manager) Open(portName string, baud int, dataBits int, parity string, stopBits float32) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.isOpen {
		_ = m.closeLocked()
	}

	normPort := normalizePort(portName)

	var p serial.Parity
	switch strings.ToLower(parity) {
	case "even":
		p = serial.EvenParity
	case "odd":
		p = serial.OddParity
	case "mark":
		p = serial.MarkParity
	case "space":
		p = serial.SpaceParity
	default:
		p = serial.NoParity
	}

	var sb serial.StopBits
	switch stopBits {
	case 1.5:
		sb = serial.OnePointFiveStopBits
	case 2:
		sb = serial.TwoStopBits
	default:
		sb = serial.OneStopBit
	}

	if dataBits <= 0 {
		dataBits = 8
	}

	mode := &serial.Mode{
		BaudRate: baud,
		DataBits: dataBits,
		Parity:   p,
		StopBits: sb,
	}

	sp, err := serial.Open(normPort, mode)
	if err != nil {
		return fmt.Errorf("không thể mở cổng %s (Baud: %d): %w", portName, baud, err)
	}

	// Set initial read timeout for responsive polling
	_ = sp.SetReadTimeout(50 * time.Millisecond)

	m.port = sp
	m.portName = portName
	m.baudRate = baud
	m.isOpen = true
	m.stopChan = make(chan struct{})

	go m.readLoop(sp, m.stopChan)
	return nil
}

// readLoop reads bytes from the port in chunks and bundles them into frames.
func (m *Manager) readLoop(sp serial.Port, stopChan chan struct{}) {
	buf := make([]byte, 1024)
	for {
		select {
		case <-stopChan:
			return
		default:
		}

		n, err := sp.Read(buf)
		if err != nil {
			if err == io.EOF {
				return
			}
			// Check if closed
			select {
			case <-stopChan:
				return
			default:
				time.Sleep(10 * time.Millisecond)
				continue
			}
		}

		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			frame := formatFrame("rx", chunk)
			if m.onFrame != nil {
				m.onFrame(frame)
			}
		}
	}
}

// formatFrame converts raw bytes into a human-readable RawSerialFrame.
func formatFrame(direction string, b []byte) RawSerialFrame {
	var hexParts []string
	for _, byteVal := range b {
		hexParts = append(hexParts, fmt.Sprintf("%02X", byteVal))
	}
	hexStr := strings.Join(hexParts, " ")

	var asciiParts []rune
	for _, byteVal := range b {
		if byteVal >= 32 && byteVal <= 126 {
			asciiParts = append(asciiParts, rune(byteVal))
		} else if byteVal == '\r' {
			asciiParts = append(asciiParts, '\\', 'r')
		} else if byteVal == '\n' {
			asciiParts = append(asciiParts, '\\', 'n')
		} else if byteVal == '\t' {
			asciiParts = append(asciiParts, '\\', 't')
		} else {
			asciiParts = append(asciiParts, '.')
		}
	}

	return RawSerialFrame{
		Timestamp: time.Now().Format("15:04:05.000"),
		Direction: direction,
		Hex:       hexStr,
		ASCII:     string(asciiParts),
		Length:    len(b),
	}
}

// Write sends raw bytes to the port and returns the number of bytes written.
func (m *Manager) Write(data []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isOpen || m.port == nil {
		return 0, fmt.Errorf("cổng serial chưa được kết nối")
	}

	n, err := m.port.Write(data)
	if err != nil {
		return n, err
	}

	if n > 0 && m.onFrame != nil {
		frame := formatFrame("tx", data[:n])
		m.onFrame(frame)
	}

	return n, nil
}

// SetDTR controls the Data Terminal Ready pin.
func (m *Manager) SetDTR(val bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.isOpen || m.port == nil {
		return fmt.Errorf("cổng serial chưa mở")
	}
	return m.port.SetDTR(val)
}

// SetRTS controls the Request To Send pin.
func (m *Manager) SetRTS(val bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.isOpen || m.port == nil {
		return fmt.Errorf("cổng serial chưa mở")
	}
	return m.port.SetRTS(val)
}

// Close shuts down the connection.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.closeLocked()
}

func (m *Manager) closeLocked() error {
	if !m.isOpen {
		return nil
	}
	m.isOpen = false
	if m.stopChan != nil {
		close(m.stopChan)
		m.stopChan = nil
	}
	var err error
	if m.port != nil {
		err = m.port.Close()
		m.port = nil
	}
	m.portName = ""
	return err
}

// IsOpen returns whether a port is currently open.
func (m *Manager) IsOpen() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isOpen
}

// GetPort returns the currently connected port name.
func (m *Manager) GetPort() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.portName
}

// CalculateCRC16Modbus computes the standard CRC-16 (0xA001 reversed polynomial).
func CalculateCRC16Modbus(data []byte) (uint16, []byte) {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if (crc & 0x0001) != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	// Little-endian byte order (standard for Modbus RTU)
	le := []byte{byte(crc & 0xFF), byte((crc >> 8) & 0xFF)}
	return crc, le
}

// ParseHexOrASCII converts input text into raw bytes.
// If isHex is true, cleans up spaces, commas, 0x prefix, and parses as hex.
func ParseHexOrASCII(text string, isHex bool) ([]byte, error) {
	if !isHex {
		// Replace escape sequences \r, \n, \t
		s := strings.ReplaceAll(text, `\r`, "\r")
		s = strings.ReplaceAll(s, `\n`, "\n")
		s = strings.ReplaceAll(s, `\t`, "\t")
		return []byte(s), nil
	}

	clean := strings.ReplaceAll(text, "0x", "")
	clean = strings.ReplaceAll(clean, "0X", "")
	clean = strings.ReplaceAll(clean, ",", "")
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, "\t", "")
	clean = strings.ReplaceAll(clean, "\r", "")
	clean = strings.ReplaceAll(clean, "\n", "")

	if len(clean)%2 != 0 {
		clean = "0" + clean
	}

	return hex.DecodeString(clean)
}
