package modbus

import (
	"encoding/binary"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// slowTCPDevice is a Modbus TCP server that answers FC03 after a delay, so a read is almost
// always in flight when polling is restarted.
func slowTCPDevice(t *testing.T, delay time.Duration) uint16 {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				req := make([]byte, 12) // MBAP (7) + FC03 PDU (5)
				for {
					if _, err := io.ReadFull(c, req); err != nil {
						return
					}
					time.Sleep(delay)
					qty := binary.BigEndian.Uint16(req[10:12])
					resp := make([]byte, 9+2*int(qty))
					copy(resp[0:2], req[0:2]) // transaction id
					binary.BigEndian.PutUint16(resp[4:6], uint16(3+2*int(qty)))
					resp[6] = req[6] // unit id
					resp[7] = 0x03
					resp[8] = byte(2 * qty)
					if _, err := c.Write(resp); err != nil {
						return
					}
				}
			}(c)
		}
	}()
	return uint16(ln.Addr().(*net.TCPAddr).Port)
}

// After MasterStartPolling returns with a new definition, no result of the previous run may be
// emitted, even if that run had a read in flight while it was cancelled.
func TestPollRestartEmitsNoStaleResults(t *testing.T) {
	port := slowTCPDevice(t, 80*time.Millisecond)

	var current atomic.Uint32 // start address of the run that is currently active
	var mu sync.Mutex
	var stale []uint16

	sm := NewSessionManager(func(_ string, res PollResult) {
		if want := uint16(current.Load()); res.StartAddress != want {
			mu.Lock()
			stale = append(stale, res.StartAddress)
			mu.Unlock()
		}
	}, nil)

	const id = "restart"
	if _, err := sm.MasterConnect(id, ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 1000}); err != nil {
		t.Fatal(err)
	}
	defer sm.CloseSession(id)

	for i := 0; i < 15; i++ {
		addr := uint16(i * 10)
		if err := sm.MasterStartPolling(id, PollDefinition{SlaveID: 1, FunctionCode: 3, StartAddress: addr, Quantity: 2, ScanRateMs: 50}); err != nil {
			t.Fatal(err)
		}
		// Once Start has returned, every result must come from the new run (its first tick is
		// 50ms away, so marking it current here cannot flag the new run's own results).
		current.Store(uint32(addr))
		time.Sleep(120 * time.Millisecond)
	}
	sm.MasterStopPolling(id)
	time.Sleep(150 * time.Millisecond) // let a read that was in flight at Stop finish

	mu.Lock()
	defer mu.Unlock()
	if len(stale) > 0 {
		t.Fatalf("%d stale results emitted after restart (start addresses %v)", len(stale), stale)
	}
}
