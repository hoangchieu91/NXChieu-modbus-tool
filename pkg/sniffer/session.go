package sniffer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

const (
	// captureQueueSize bounds frames waiting for the analyzer. Forwarding never waits for the
	// analyzer: when the queue is full the frame is dropped from analysis and counted.
	captureQueueSize = 4096
	// maxProxyConnections caps simultaneous masters through one proxy.
	maxProxyConnections = 64
	// proxyDialTimeout bounds connecting to the proxied device.
	proxyDialTimeout = 5 * time.Second
)

// observedFrame is a framed ADU waiting to be handed to the analyzer engine.
type observedFrame struct {
	source, captureSource string
	transport             Transport
	direction             Direction
	raw                   []byte
	at                    time.Time
}

// SessionManager owns the active external capture adapter. Internal capture remains available
// independently through Engine.
type SessionManager struct {
	// lifecycleMu serializes Start and Stop as a whole, so two concurrent Starts can never leave
	// an orphaned listener that Stop cannot close.
	lifecycleMu sync.Mutex

	mu        sync.RWMutex
	engine    *Engine
	status    CaptureStatus
	cancel    context.CancelFunc
	listener  net.Listener
	serial    serial.Port
	conns     map[net.Conn]struct{} // proxied master connections
	upstreams map[net.Conn]struct{} // their connections to the device
	wg        sync.WaitGroup        // capture goroutines (accept, proxy, forward, serial)

	queue     chan observedFrame
	analyzeWG sync.WaitGroup // the analyzer goroutine draining queue
}

func NewSessionManager(engine *Engine) *SessionManager {
	return &SessionManager{engine: engine, conns: make(map[net.Conn]struct{}), upstreams: make(map[net.Conn]struct{})}
}

func (m *SessionManager) Start(config CaptureConfig) (CaptureStatus, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	m.stopLocked()
	ctx, cancel := context.WithCancel(context.Background())
	queue := make(chan observedFrame, captureQueueSize)
	m.mu.Lock()
	m.cancel = cancel
	m.queue = queue
	m.status = CaptureStatus{Mode: config.Mode, StartedAt: time.Now().Format(time.RFC3339)}
	m.mu.Unlock()

	m.analyzeWG.Add(1)
	go m.analyzeLoop(queue)

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
		m.stopLocked()
		m.setError(err)
		return m.Status(), err
	}
	m.mu.Lock()
	m.status.Running = true
	m.mu.Unlock()
	return m.Status(), nil
}

func (m *SessionManager) Stop() CaptureStatus {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.stopLocked()
	return m.Status()
}

// stopLocked tears the capture down and joins every goroutine. Requires lifecycleMu.
func (m *SessionManager) stopLocked() {
	m.mu.Lock()
	cancel, listener, port, queue := m.cancel, m.listener, m.serial, m.queue
	m.cancel, m.listener, m.serial, m.queue = nil, nil, nil, nil
	connections := make([]net.Conn, 0, len(m.conns)+len(m.upstreams))
	for conn := range m.conns {
		connections = append(connections, conn)
	}
	for conn := range m.upstreams {
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
	// Every producer has exited: drain what is queued, then stop the analyzer.
	if queue != nil {
		close(queue)
		m.analyzeWG.Wait()
	}
}

// fail ends a capture whose source died (listener error, unplugged USB adapter) so the status
// does not keep claiming "running" with the port still held. It runs in a capture goroutine,
// so it only cancels and closes; the goroutines are joined by the next Stop/Start.
func (m *SessionManager) fail(err error) {
	m.mu.Lock()
	m.status.LastError = err.Error()
	m.status.Running = false
	cancel, listener, port := m.cancel, m.listener, m.serial
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
}

func (m *SessionManager) Status() CaptureStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	status := m.status
	status.ActiveConnections = len(m.conns)
	return status
}

func (m *SessionManager) analyzeLoop(queue <-chan observedFrame) {
	defer m.analyzeWG.Done()
	for f := range queue {
		m.engine.AddObserved(f.source, f.captureSource, f.transport, f.direction, f.raw, QualityWire, f.at)
	}
}

func validateProxyConfig(config CaptureConfig) error {
	if config.TargetHost == "" || config.TargetPort == 0 {
		return fmt.Errorf("target host and target port are required")
	}
	// ListenPort 0 lets the OS pick a free port; the chosen address is reported in the status.
	if config.ListenPort == config.TargetPort && isLocalHost(config.TargetHost) {
		// The proxy would connect to itself, recursively, until sockets run out.
		return fmt.Errorf("proxy target %s:%d is the proxy itself", config.TargetHost, config.TargetPort)
	}
	return nil
}

func isLocalHost(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "0.0.0.0", "::", "":
		return true
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.String() == host {
			return true
		}
	}
	return false
}

func (m *SessionManager) startProxy(ctx context.Context, config CaptureConfig) error {
	if err := validateProxyConfig(config); err != nil {
		return err
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
				m.fail(fmt.Errorf("accept proxy connection: %w", err))
			}
			return
		}
		m.mu.Lock()
		full := len(m.conns) >= maxProxyConnections
		if !full {
			m.conns[client] = struct{}{}
		}
		m.mu.Unlock()
		if full {
			_ = client.Close()
			m.setError(fmt.Errorf("proxy connection limit (%d) reached", maxProxyConnections))
			continue
		}
		// Dial in the connection goroutine: an unreachable target must not block other accepts,
		// and Stop cancels the dial.
		m.wg.Add(1)
		go m.proxyConnection(ctx, client, config)
	}
}

func (m *SessionManager) proxyConnection(ctx context.Context, client net.Conn, config CaptureConfig) {
	defer m.wg.Done()
	defer func() {
		_ = client.Close()
		m.trackConn(client, false)
	}()

	dialer := net.Dialer{Timeout: proxyDialTimeout}
	upstream, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(config.TargetHost, fmt.Sprint(config.TargetPort)))
	if err != nil {
		if ctx.Err() == nil {
			m.setError(fmt.Errorf("connect proxy target: %w", err))
		}
		return
	}
	m.trackUpstream(upstream, true)
	defer func() {
		_ = upstream.Close()
		m.trackUpstream(upstream, false)
	}()

	transport := TransportTCP
	if config.Mode == ModeRTUOverTCP {
		transport = TransportRTU
	}
	source := fmt.Sprintf("proxy:%s", client.RemoteAddr())
	var forwards sync.WaitGroup
	forwards.Add(2)
	go func() {
		defer forwards.Done()
		m.forward(ctx, source, client, upstream, transport, DirectionMasterToSlave)
	}()
	go func() {
		defer forwards.Done()
		m.forward(ctx, source, upstream, client, transport, DirectionSlaveToMaster)
	}()
	// Both directions finish on their own (EOF is propagated with a half-close); Stop closes
	// the sockets, which ends both reads.
	forwards.Wait()
}

func (m *SessionManager) forward(ctx context.Context, source string, from, to net.Conn, transport Transport, direction Direction) {
	framer := NewStreamFramer(transport)
	buffer := make([]byte, 32*1024)
	gap := 20 * time.Millisecond // RTU over TCP: packetization by the gateway dominates t3.5
	for {
		if transport == TransportRTU {
			_ = from.SetReadDeadline(time.Now().Add(gap))
		}
		n, err := from.Read(buffer)
		if n > 0 {
			chunk := buffer[:n]
			// Forward first: capture must never delay or alter the bytes on the wire.
			if _, writeErr := to.Write(chunk); writeErr != nil {
				_ = from.Close()
				return
			}
			m.addBytes(uint64(n))
			beforeDrop := framer.Dropped()
			m.addFramed(source, "proxy", transport, direction, framer, beforeDrop, framer.Feed(chunk))
		}
		if err != nil {
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() && ctx.Err() == nil {
				beforeDrop := framer.Dropped()
				m.addFramed(source, "proxy", transport, direction, framer, beforeDrop, framer.FlushGap())
				continue
			}
			if err == io.EOF {
				// The sender finished: pass the half-close on so a reply already on its way in
				// the other direction is still delivered.
				if tcp, ok := to.(*net.TCPConn); ok {
					_ = tcp.CloseWrite()
				} else {
					_ = to.Close()
				}
			} else {
				if ctx.Err() == nil && !strings.Contains(err.Error(), "closed") {
					m.setError(fmt.Errorf("proxy read: %w", err))
				}
				_ = to.Close()
			}
			return
		}
	}
}

// rtuGap is the silent interval that ends an RTU frame: t3.5 (3.5 characters of 11 bits,
// fixed at 1.75 ms above 19200 baud) plus margin for USB adapter latency.
func rtuGap(baud int) time.Duration {
	t35 := 1750 * time.Microsecond
	if baud > 0 && baud <= 19200 {
		t35 = time.Duration(float64(time.Second) * 3.5 * 11 / float64(baud))
	}
	return t35 + 15*time.Millisecond
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
	// The read timeout is the frame gap, so it follows the baud rate (a fixed 20 ms split
	// frames below ~600 baud).
	_ = port.SetReadTimeout(rtuGap(config.BaudRate))
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
			m.fail(fmt.Errorf("serial capture: %w", err))
			return
		}
	}
}

func (m *SessionManager) addFramed(source, captureSource string, transport Transport, direction Direction, framer *StreamFramer, before uint64, frames [][]byte) {
	dropped := framer.Dropped()
	if dropped > before {
		m.mu.Lock()
		m.status.DroppedChunks += dropped - before
		m.mu.Unlock()
	}
	if len(frames) == 0 {
		return
	}
	now := time.Now()
	for _, frame := range frames {
		// The framer reuses its buffer; the queued frame needs its own copy.
		m.enqueue(observedFrame{source, captureSource, transport, direction, append([]byte(nil), frame...), now})
	}
}

// enqueue hands a frame to the analyzer without ever blocking the capture path.
func (m *SessionManager) enqueue(f observedFrame) {
	m.mu.RLock()
	queue := m.queue
	m.mu.RUnlock()
	select {
	case queue <- f:
	default:
		m.mu.Lock()
		m.status.DroppedFrames++
		m.mu.Unlock()
	}
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

func (m *SessionManager) trackUpstream(conn net.Conn, add bool) {
	m.mu.Lock()
	if add {
		m.upstreams[conn] = struct{}{}
	} else {
		delete(m.upstreams, conn)
	}
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
