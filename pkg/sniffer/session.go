package sniffer

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

// SessionManager owns the active external capture adapter. Internal capture remains available
// independently through Engine.
type SessionManager struct {
	mu       sync.RWMutex
	engine   *Engine
	status   CaptureStatus
	cancel   context.CancelFunc
	listener net.Listener
	serial   serial.Port
	conns    map[net.Conn]struct{}
	wg       sync.WaitGroup
}

func NewSessionManager(engine *Engine) *SessionManager {
	return &SessionManager{engine: engine, conns: make(map[net.Conn]struct{})}
}

func (m *SessionManager) Start(config CaptureConfig) (CaptureStatus, error) {
	m.Stop()
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.cancel = cancel
	m.status = CaptureStatus{Mode: config.Mode, StartedAt: time.Now().Format(time.RFC3339)}
	m.mu.Unlock()

	var err error
	switch config.Mode {
	case ModeTCPProxy, ModeRTUOverTCP:
		err = m.startProxy(ctx, config)
	case ModePassiveSerial:
		err = m.startSerial(ctx, config)
	case ModePassivePCAP:
		err = m.startPCAP(ctx, config)
	default:
		err = fmt.Errorf("capture mode %q is not supported", config.Mode)
	}
	if err != nil {
		cancel()
		m.setError(err)
		return m.Status(), err
	}
	m.mu.Lock()
	m.status.Running = true
	m.mu.Unlock()
	return m.Status(), nil
}

func (m *SessionManager) Stop() CaptureStatus {
	m.mu.Lock()
	cancel, listener, port := m.cancel, m.listener, m.serial
	m.cancel, m.listener, m.serial = nil, nil, nil
	connections := make([]net.Conn, 0, len(m.conns))
	for conn := range m.conns {
		connections = append(connections, conn)
	}
	m.status.Running = false
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if listener != nil {
		_ = listener.Close()
	}
	if port != nil {
		_ = port.Close()
	}
	for _, conn := range connections {
		_ = conn.Close()
	}
	m.wg.Wait()
	return m.Status()
}

func (m *SessionManager) Status() CaptureStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	status := m.status
	status.ActiveConnections = len(m.conns)
	return status
}

func (m *SessionManager) startProxy(ctx context.Context, config CaptureConfig) error {
	if config.TargetHost == "" || config.TargetPort == 0 {
		return fmt.Errorf("target host and target port are required")
	}
	host := config.ListenHost
	if host == "" {
		host = "0.0.0.0"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(config.ListenPort)))
	if err != nil {
		return fmt.Errorf("listen proxy: %w", err)
	}
	m.mu.Lock()
	m.listener = listener
	m.status.ListenAddress = listener.Addr().String()
	m.status.TargetAddress = net.JoinHostPort(config.TargetHost, fmt.Sprint(config.TargetPort))
	m.mu.Unlock()
	m.wg.Add(1)
	go m.acceptLoop(ctx, listener, config)
	return nil
}

func (m *SessionManager) acceptLoop(ctx context.Context, listener net.Listener, config CaptureConfig) {
	defer m.wg.Done()
	for {
		client, err := listener.Accept()
		if err != nil {
			if ctx.Err() == nil {
				m.setError(fmt.Errorf("accept proxy connection: %w", err))
			}
			return
		}
		upstream, err := net.DialTimeout("tcp", net.JoinHostPort(config.TargetHost, fmt.Sprint(config.TargetPort)), 5*time.Second)
		if err != nil {
			_ = client.Close()
			m.setError(fmt.Errorf("connect proxy target: %w", err))
			continue
		}
		m.trackConn(client, true)
		m.wg.Add(1)
		go m.proxyConnection(ctx, client, upstream, config.Mode)
	}
}

func (m *SessionManager) proxyConnection(ctx context.Context, client, upstream net.Conn, mode CaptureMode) {
	defer m.wg.Done()
	defer func() {
		_ = client.Close()
		_ = upstream.Close()
		m.trackConn(client, false)
	}()
	transport := TransportTCP
	if mode == ModeRTUOverTCP {
		transport = TransportRTU
	}
	source := fmt.Sprintf("proxy:%s", client.RemoteAddr())
	done := make(chan struct{}, 2)
	go func() {
		m.forward(ctx, source, client, upstream, transport, DirectionMasterToSlave)
		done <- struct{}{}
	}()
	go func() {
		m.forward(ctx, source, upstream, client, transport, DirectionSlaveToMaster)
		done <- struct{}{}
	}()
	select {
	case <-ctx.Done():
	case <-done:
	}
}

func (m *SessionManager) forward(ctx context.Context, source string, from, to net.Conn, transport Transport, direction Direction) {
	framer := NewStreamFramer(transport)
	buffer := make([]byte, 32*1024)
	for {
		if transport == TransportRTU {
			_ = from.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
		}
		n, err := from.Read(buffer)
		if n > 0 {
			chunk := buffer[:n]
			if _, writeErr := to.Write(chunk); writeErr != nil {
				return
			}
			m.addBytes(uint64(n))
			beforeDrop := framer.Dropped()
			m.addFramed(source, "proxy", transport, direction, framer, beforeDrop, framer.Feed(chunk))
		}
		if err != nil {
			if timeout, ok := err.(net.Error); ok && timeout.Timeout() && ctx.Err() == nil {
				beforeDrop := framer.Dropped()
				m.addFramed(source, "proxy", transport, direction, framer, beforeDrop, framer.FlushGap())
				continue
			}
			if err != io.EOF && ctx.Err() == nil && !strings.Contains(err.Error(), "closed") {
				m.setError(fmt.Errorf("proxy read: %w", err))
			}
			return
		}
	}
}

func (m *SessionManager) startSerial(ctx context.Context, config CaptureConfig) error {
	if config.SerialPort == "" || config.BaudRate <= 0 {
		return fmt.Errorf("serial port and baud rate are required")
	}
	mode := &serial.Mode{BaudRate: config.BaudRate, DataBits: config.DataBits}
	if mode.DataBits == 0 {
		mode.DataBits = 8
	}
	switch strings.ToLower(config.Parity) {
	case "even":
		mode.Parity = serial.EvenParity
	case "odd":
		mode.Parity = serial.OddParity
	default:
		mode.Parity = serial.NoParity
	}
	if config.StopBits == 2 {
		mode.StopBits = serial.TwoStopBits
	} else {
		mode.StopBits = serial.OneStopBit
	}
	port, err := serial.Open(config.SerialPort, mode)
	if err != nil {
		return fmt.Errorf("open passive serial %s: %w", config.SerialPort, err)
	}
	_ = port.SetReadTimeout(20 * time.Millisecond)
	m.mu.Lock()
	m.serial = port
	m.status.ListenAddress = fmt.Sprintf("%s @ %d", config.SerialPort, config.BaudRate)
	m.mu.Unlock()
	m.wg.Add(1)
	go m.serialLoop(ctx, port, config.SerialPort)
	return nil
}

func (m *SessionManager) serialLoop(ctx context.Context, port serial.Port, source string) {
	defer m.wg.Done()
	framer := NewStreamFramer(TransportRTU)
	buffer := make([]byte, 1024)
	for ctx.Err() == nil {
		n, err := port.Read(buffer)
		if n > 0 {
			m.addBytes(uint64(n))
			beforeDrop := framer.Dropped()
			m.addFramed("serial:"+source, "passive_serial", TransportRTU, DirectionUnknown, framer, beforeDrop, framer.Feed(buffer[:n]))
		} else {
			beforeDrop := framer.Dropped()
			m.addFramed("serial:"+source, "passive_serial", TransportRTU, DirectionUnknown, framer, beforeDrop, framer.FlushGap())
		}
		if err != nil && ctx.Err() == nil {
			m.setError(fmt.Errorf("serial capture: %w", err))
			return
		}
	}
}

func (m *SessionManager) addFrames(source, captureSource string, transport Transport, direction Direction, frames [][]byte) {
	for _, frame := range frames {
		m.engine.AddObserved(source, captureSource, transport, direction, frame, QualityWire, time.Now())
	}
}

func (m *SessionManager) addFramed(source, captureSource string, transport Transport, direction Direction, framer *StreamFramer, before uint64, frames [][]byte) {
	dropped := framer.Dropped()
	if dropped > before {
		m.mu.Lock()
		m.status.DroppedChunks += dropped - before
		m.mu.Unlock()
	}
	m.addFrames(source, captureSource, transport, direction, frames)
}

func (m *SessionManager) addBytes(count uint64) {
	m.mu.Lock()
	m.status.BytesCaptured += count
	m.mu.Unlock()
}

func (m *SessionManager) setError(err error) {
	m.mu.Lock()
	m.status.LastError = err.Error()
	m.mu.Unlock()
}

func (m *SessionManager) trackConn(conn net.Conn, add bool) {
	m.mu.Lock()
	if add {
		m.conns[conn] = struct{}{}
	} else {
		delete(m.conns, conn)
	}
	m.mu.Unlock()
}
