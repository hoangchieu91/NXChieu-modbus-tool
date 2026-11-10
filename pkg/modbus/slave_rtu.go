package modbus

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
	"go.bug.st/serial"
)

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
				reqHex := strings.ToUpper(hex.EncodeToString(frame))
				unitID := frame[0]
				fc := frame[1]
				nowStr := time.Now().Format("15:04:05.000")

				// Emit RX event so all frames on the bus show up in Traffic log
				if store.onActivity != nil {
					store.onActivity(SlaveActivityEvent{
						SessionID: store.sessionID,
						Timestamp: nowStr,
						Client:    clientAddr,
						Function:  fmt.Sprintf("FC%02X", fc),
						IsWrite:   false,
						HexRaw:    reqHex,
						Summary:   fmt.Sprintf("RX [Unit %d, FC%02X, %d bytes]", unitID, fc, len(frame)),
					})
				}

				if resp := s.processRTUFrame(store, slaveID, frame, clientAddr); len(resp) > 0 {
					_, _ = rw.Write(resp)
					// Emit TX event so slave response shows up in Traffic log
					if store.onActivity != nil {
						store.onActivity(SlaveActivityEvent{
							SessionID: store.sessionID,
							Timestamp: time.Now().Format("15:04:05.000"),
							Client:    clientAddr,
							Function:  fmt.Sprintf("FC%02X Resp", fc),
							IsWrite:   true,
							HexRaw:    strings.ToUpper(hex.EncodeToString(resp)),
							Summary:   fmt.Sprintf("TX [Unit %d, %d bytes]", unitID, len(resp)),
						})
					}
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
func (s *ModbusSlaveServer) processRTUFrame(store *SlaveMemoryStore, fallbackSlaveID uint8, frame []byte, clientAddr string) []byte {
	unitID := frame[0]
	startID, endID := store.GetSlaveRange()
	if startID == 0 {
		startID = fallbackSlaveID
	}
	if endID < startID {
		endID = startID
	}
	if unitID != 0 && (unitID < startID || unitID > endID) {
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

// Response builders keep the protocol limits as guards (a byte count cannot exceed 250) and
// reuse the shared RTU frame builders.
func (s *ModbusSlaveServer) buildBitReadResponse(unitID uint8, fc uint8, bools []bool) []byte {
	if len(bools) > 2000 {
		return s.buildExceptionResponse(unitID, fc, 0x03)
	}
	return BuildRTUCoilResponse(unitID, fc, bools)
}

func (s *ModbusSlaveServer) buildRegisterReadResponse(unitID uint8, fc uint8, regs []uint16) []byte {
	if len(regs) > 125 {
		return s.buildExceptionResponse(unitID, fc, 0x03)
	}
	return BuildRTURegisterResponse(unitID, fc, regs)
}

func (s *ModbusSlaveServer) buildExceptionResponse(unitID uint8, fc uint8, exceptionCode byte) []byte {
	return BuildRTUExceptionResponse(unitID, fc, exceptionCode)
}
