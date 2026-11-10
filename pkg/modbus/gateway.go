package modbus

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.bug.st/serial"
)

// GatewayConfig holds configuration for the Modbus TCP <-> RTU bridge.
type GatewayConfig struct {
	TcpPort    int    `json:"tcp_port"`    // e.g. 502 or 1502
	SerialPort string `json:"serial_port"` // e.g. COM13
	BaudRate   int    `json:"baud_rate"`   // e.g. 9600, 19200
	DataBits   int    `json:"data_bits"`   // e.g. 8
	Parity     string `json:"parity"`      // none, even, odd
	StopBits   int    `json:"stop_bits"`   // 1 or 2
	TimeoutMs  int    `json:"timeout_ms"`  // e.g. 1000ms
}

// GatewayStats reports live telemetry for the bridge.
type GatewayStats struct {
	IsRunning       bool   `json:"is_running"`
	TcpAddress      string `json:"tcp_address"`
	SerialPort      string `json:"serial_port"`
	ActiveClients   int    `json:"active_clients"`
	PacketsBridged  uint64 `json:"packets_bridged"`
	PacketsFailed   uint64 `json:"packets_failed"`
	BytesTx         uint64 `json:"bytes_tx"`
	BytesRx         uint64 `json:"bytes_rx"`
	LastLatencyMs   int64  `json:"last_latency_ms"`
	LastActivityStr string `json:"last_activity_str"`
}

// GatewayTrafficEvent is emitted to frontend for realtime packet inspection.
type GatewayTrafficEvent struct {
	Timestamp   string `json:"timestamp"`
	ClientAddr  string `json:"client_addr"`
	UnitID      uint8  `json:"unit_id"`
	Function    string `json:"function"`
	TcpTxHex    string `json:"tcp_tx_hex"`    // Incoming from SCADA
	RtuTxHex    string `json:"rtu_tx_hex"`    // Forwarded to serial
	RtuRxHex    string `json:"rtu_rx_hex"`    // Answer from slave
	LatencyMs   int64  `json:"latency_ms"`
	Status      string `json:"status"` // "OK", "TIMEOUT", "CRC_ERR", "ERR"
	Description string `json:"description"`
}

// ModbusGatewayBridge manages transparent routing between Modbus TCP and RTU serial.
type ModbusGatewayBridge struct {
	mu          sync.Mutex
	serialMu    sync.Mutex // serial bus serialization mutex
	config      GatewayConfig
	isRunning   bool
	listener    net.Listener
	sp          serial.Port
	clients     map[net.Conn]struct{}
	stopSignal  chan struct{}
	onTraffic   func(event GatewayTrafficEvent)
	stats       GatewayStats
	packetsDone uint64
	packetsFail uint64
	bytesTx     uint64
	bytesRx     uint64
}

// NewModbusGatewayBridge initializes a new gateway manager.
func NewModbusGatewayBridge(onTraffic func(event GatewayTrafficEvent)) *ModbusGatewayBridge {
	return &ModbusGatewayBridge{
		clients:   make(map[net.Conn]struct{}),
		onTraffic: onTraffic,
	}
}

// Start launches the TCP listener and binds the target serial port.
func (g *ModbusGatewayBridge) Start(cfg GatewayConfig) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.isRunning {
		return fmt.Errorf("Gateway is already running on port %d", g.config.TcpPort)
	}

	if cfg.TcpPort <= 0 {
		cfg.TcpPort = 1502
	}
	if cfg.TimeoutMs <= 0 {
		cfg.TimeoutMs = 1000
	}
	if cfg.BaudRate <= 0 {
		cfg.BaudRate = 9600
	}
	if cfg.DataBits <= 0 {
		cfg.DataBits = 8
	}
	if cfg.StopBits <= 0 {
		cfg.StopBits = 1
	}

	// 1. Open target serial port
	portName := normalizeSerialPort(cfg.SerialPort)
	mode := &serial.Mode{
		BaudRate: cfg.BaudRate,
		DataBits: cfg.DataBits,
		Parity:   serialParity(cfg.Parity),
		StopBits: serial.OneStopBit,
	}
	if cfg.StopBits == 2 {
		mode.StopBits = serial.TwoStopBits
	}

	sp, err := serial.Open(portName, mode)
	if err != nil {
		return fmt.Errorf("failed to open serial port %s: %w", portName, err)
	}
	_ = sp.SetReadTimeout(rtuSilence(cfg.BaudRate))

	// 2. Open TCP listener
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", cfg.TcpPort))
	if err != nil {
		_ = sp.Close()
		return fmt.Errorf("failed to bind TCP port %d: %w", cfg.TcpPort, err)
	}

	g.config = cfg
	g.sp = sp
	g.listener = ln
	g.isRunning = true
	g.clients = make(map[net.Conn]struct{})
	g.stopSignal = make(chan struct{})

	atomic.StoreUint64(&g.packetsDone, 0)
	atomic.StoreUint64(&g.packetsFail, 0)
	atomic.StoreUint64(&g.bytesTx, 0)
	atomic.StoreUint64(&g.bytesRx, 0)

	log.Printf("[GATEWAY] Started Modbus TCP <-> RTU Bridge on :%d -> %s (%d %d-%s-%d)",
		cfg.TcpPort, cfg.SerialPort, cfg.BaudRate, cfg.DataBits, cfg.Parity, cfg.StopBits)

	go g.acceptLoop(ln)
	return nil
}

// Stop gracefully shuts down active TCP connections and closes the serial port.
func (g *ModbusGatewayBridge) Stop() {
	g.mu.Lock()
	if !g.isRunning {
		g.mu.Unlock()
		return
	}
	g.isRunning = false
	if g.stopSignal != nil {
		close(g.stopSignal)
	}
	if g.listener != nil {
		_ = g.listener.Close()
		g.listener = nil
	}
	for c := range g.clients {
		_ = c.Close()
	}
	g.clients = make(map[net.Conn]struct{})

	g.serialMu.Lock()
	if g.sp != nil {
		_ = g.sp.Close()
		g.sp = nil
	}
	g.serialMu.Unlock()

	g.mu.Unlock()
	log.Printf("[GATEWAY] Bridge stopped")
}

// GetStats returns the current status and metrics of the gateway.
func (g *ModbusGatewayBridge) GetStats() GatewayStats {
	g.mu.Lock()
	defer g.mu.Unlock()

	return GatewayStats{
		IsRunning:      g.isRunning,
		TcpAddress:     fmt.Sprintf("0.0.0.0:%d", g.config.TcpPort),
		SerialPort:     g.config.SerialPort,
		ActiveClients:  len(g.clients),
		PacketsBridged: atomic.LoadUint64(&g.packetsDone),
		PacketsFailed:  atomic.LoadUint64(&g.packetsFail),
		BytesTx:        atomic.LoadUint64(&g.bytesTx),
		BytesRx:        atomic.LoadUint64(&g.bytesRx),
		LastLatencyMs:  g.stats.LastLatencyMs,
	}
}

func (g *ModbusGatewayBridge) acceptLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}

		g.mu.Lock()
		if !g.isRunning {
			g.mu.Unlock()
			_ = conn.Close()
			return
		}
		g.clients[conn] = struct{}{}
		g.mu.Unlock()

		go g.handleClient(conn)
	}
}

func (g *ModbusGatewayBridge) handleClient(c net.Conn) {
	defer func() {
		g.mu.Lock()
		delete(g.clients, c)
		g.mu.Unlock()
		_ = c.Close()
	}()

	clientAddr := c.RemoteAddr().String()
	mbapHeader := make([]byte, 7)

	for {
		// 1. Read MBAP Header (7 bytes: TxID 2B, ProtoID 2B, Length 2B, UnitID 1B)
		_, err := io.ReadFull(c, mbapHeader)
		if err != nil {
			return // Client disconnected or error
		}

		atomic.AddUint64(&g.bytesRx, 7)
		txID := binary.BigEndian.Uint16(mbapHeader[0:2])
		protoID := binary.BigEndian.Uint16(mbapHeader[2:4])
		length := binary.BigEndian.Uint16(mbapHeader[4:6])
		unitID := mbapHeader[6]

		if protoID != 0 || length < 2 || length > 260 {
			// Invalid Modbus TCP header: drop
			atomic.AddUint64(&g.packetsFail, 1)
			return
		}

		// 2. Read PDU (length - 1 bytes, as UnitID was byte 7)
		pduLen := int(length - 1)
		pdu := make([]byte, pduLen)
		if _, err := io.ReadFull(c, pdu); err != nil {
			atomic.AddUint64(&g.packetsFail, 1)
			return
		}
		atomic.AddUint64(&g.bytesRx, uint64(pduLen))

		fc := pdu[0]
		nowStr := time.Now().Format("15:04:05.000")
		tcpRawTx := strings.ToUpper(hex.EncodeToString(append(mbapHeader, pdu...)))

		// 3. Assemble RTU Frame: [Unit ID] + [PDU] + [CRC-16 LE]
		rtuReq := make([]byte, 1+len(pdu)+2)
		rtuReq[0] = unitID
		copy(rtuReq[1:], pdu)
		crc := CRC16Modbus(rtuReq[:1+len(pdu)])
		binary.LittleEndian.PutUint16(rtuReq[1+len(pdu):], crc)
		rtuReqHex := strings.ToUpper(hex.EncodeToString(rtuReq))

		// 4. Forward to Serial Bus with Lock & Response Read
		startReq := time.Now()
		rtuResp, err := g.transceiveSerial(rtuReq)
		elapsed := time.Since(startReq).Milliseconds()

		if err != nil {
			atomic.AddUint64(&g.packetsFail, 1)
			if g.onTraffic != nil {
				g.onTraffic(GatewayTrafficEvent{
					Timestamp:   nowStr,
					ClientAddr:  clientAddr,
					UnitID:      unitID,
					Function:    fmt.Sprintf("FC%02X", fc),
					TcpTxHex:    tcpRawTx,
					RtuTxHex:    rtuReqHex,
					RtuRxHex:    "",
					LatencyMs:   elapsed,
					Status:      "TIMEOUT",
					Description: fmt.Sprintf("Serial timeout / I/O error: %v", err),
				})
			}
			continue
		}

		// 5. Check RTU response length and CRC
		if len(rtuResp) < 4 {
			atomic.AddUint64(&g.packetsFail, 1)
			continue
		}
		respCrc := binary.LittleEndian.Uint16(rtuResp[len(rtuResp)-2:])
		calcCrc := CRC16Modbus(rtuResp[:len(rtuResp)-2])
		rtuRxHex := strings.ToUpper(hex.EncodeToString(rtuResp))

		if respCrc != calcCrc {
			atomic.AddUint64(&g.packetsFail, 1)
			if g.onTraffic != nil {
				g.onTraffic(GatewayTrafficEvent{
					Timestamp:   nowStr,
					ClientAddr:  clientAddr,
					UnitID:      unitID,
					Function:    fmt.Sprintf("FC%02X", fc),
					TcpTxHex:    tcpRawTx,
					RtuTxHex:    rtuReqHex,
					RtuRxHex:    rtuRxHex,
					LatencyMs:   elapsed,
					Status:      "CRC_ERR",
					Description: fmt.Sprintf("Slave returned bad CRC (0x%04X != 0x%04X)", respCrc, calcCrc),
				})
			}
			continue
		}

		// 6. Convert RTU Response back to Modbus TCP
		// Strip CRC (last 2 bytes), strip UnitID (byte 0)
		respPdu := rtuResp[1 : len(rtuResp)-2]
		tcpRespHeader := make([]byte, 7)
		binary.BigEndian.PutUint16(tcpRespHeader[0:2], txID)
		binary.BigEndian.PutUint16(tcpRespHeader[2:4], 0)
		binary.BigEndian.PutUint16(tcpRespHeader[4:6], uint16(1+len(respPdu)))
		tcpRespHeader[6] = unitID

		tcpRespFrame := append(tcpRespHeader, respPdu...)
		_, _ = c.Write(tcpRespFrame)

		atomic.AddUint64(&g.bytesTx, uint64(len(tcpRespFrame)))
		atomic.AddUint64(&g.packetsDone, 1)

		g.mu.Lock()
		g.stats.LastLatencyMs = elapsed
		g.mu.Unlock()

		if g.onTraffic != nil {
			g.onTraffic(GatewayTrafficEvent{
				Timestamp:   nowStr,
				ClientAddr:  clientAddr,
				UnitID:      unitID,
				Function:    fmt.Sprintf("FC%02X", fc),
				TcpTxHex:    tcpRawTx,
				RtuTxHex:    rtuReqHex,
				RtuRxHex:    rtuRxHex,
				LatencyMs:   elapsed,
				Status:      "OK",
				Description: fmt.Sprintf("OK (%d ms)", elapsed),
			})
		}
	}
}

// transceiveSerial acquires serial lock, sends the request, and awaits response with timeout.
func (g *ModbusGatewayBridge) transceiveSerial(req []byte) ([]byte, error) {
	g.serialMu.Lock()
	defer g.serialMu.Unlock()

	if g.sp == nil {
		return nil, errors.New("serial port is not open")
	}

	// Purge input buffer before transmission
	_ = g.sp.ResetInputBuffer()

	// Transmit request
	if _, err := g.sp.Write(req); err != nil {
		return nil, err
	}

	timeout := time.Duration(g.config.TimeoutMs) * time.Millisecond
	deadline := time.Now().Add(timeout)

	buf := make([]byte, 512)
	var resp []byte
	lastRx := time.Now()

	for time.Now().Before(deadline) {
		n, err := g.sp.Read(buf)
		if err != nil && err != io.EOF {
			return nil, err
		}
		if n > 0 {
			resp = append(resp, buf[:n]...)
			lastRx = time.Now()
		}

		if len(resp) >= 4 {
			// Check if we received full expected frame
			want := expectedResponseLengthBridge(resp)
			if want > 0 && len(resp) >= want {
				return resp[:want], nil
			}
		}

		// Inter-frame silence check (if at least 3 bytes received and no more bytes for t3.5)
		if len(resp) >= 4 && time.Since(lastRx) >= 20*time.Millisecond {
			return resp, nil
		}
	}

	if len(resp) >= 4 {
		return resp, nil
	}
	return nil, errors.New("timeout waiting for RTU slave response")
}

func expectedResponseLengthBridge(resp []byte) int {
	if len(resp) < 3 {
		return -1
	}
	fc := resp[1]
	if fc&0x80 != 0 {
		return 5 // Exception response: [Unit, FC|0x80, Code, CRC_L, CRC_H]
	}
	switch fc {
	case 0x01, 0x02, 0x03, 0x04:
		byteCount := int(resp[2])
		return 3 + byteCount + 2 // Unit + FC + ByteCount + Data + CRC
	case 0x05, 0x06, 0x0F, 0x10:
		return 8 // Fixed 8 bytes echo
	default:
		return -1
	}
}
