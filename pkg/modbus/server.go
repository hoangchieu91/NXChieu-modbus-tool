package modbus

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
	"go.bug.st/serial"
)

// ModbusSlaveServer encapsulates TCP, Serial RTU, and RTU-over-TCP slave servers.
type ModbusSlaveServer struct {
	mu          sync.Mutex
	sessionID   string
	config      SlaveConfig
	store       *SlaveMemoryStore
	isListening bool
	tcpServer   *simonmodbus.ModbusServer
	tcpListener net.Listener
	tcpConns    map[net.Conn]struct{}
	serialPort  serial.Port
	simCancel   context.CancelFunc
	onActivity  func(SlaveActivityEvent)
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
	slaveIDEnd := config.SlaveIDEnd
	if slaveIDEnd < slaveID {
		slaveIDEnd = slaveID
	}

	// Keep memory edited by the user before starting; only the unit ID changes.
	if s.store == nil {
		s.store = NewSlaveMemoryStore(s.sessionID, slaveID, s.onActivity)
	}
	s.store.setSlaveRange(slaveID, slaveIDEnd)
	s.config.SlaveID = slaveID
	s.config.SlaveIDEnd = slaveIDEnd

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
		parity := serialParity(config.Parity)
		var stopBits serial.StopBits = serial.OneStopBit
		if config.StopBits == 2 {
			stopBits = serial.TwoStopBits
		}

		portName := normalizeSerialPort(config.Port)

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
