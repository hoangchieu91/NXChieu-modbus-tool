package modbus

import (
	"net"
	"testing"
	"time"
)

// silentDevice accepts TCP connections and never answers, so every request times out.
func silentDevice(t *testing.T) (port uint16) {
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
			go func() {
				buf := make([]byte, 256)
				for {
					if _, err := c.Read(buf); err != nil {
						_ = c.Close()
						return
					}
				}
			}()
		}
	}()
	return uint16(ln.Addr().(*net.TCPAddr).Port)
}

func TestProbeSlaveUsesScannerTimeout(t *testing.T) {
	old := scanTimeoutHold
	scanTimeoutHold = 50 * time.Millisecond
	defer func() { scanTimeoutHold = old }()

	port := silentDevice(t)
	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 3000}); err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect()

	start := time.Now()
	res := m.ProbeSlave(1, 100)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("probe with 100ms timeout took %v (connection timeout is 3s)", elapsed)
	}
	if res.Status != "offline" {
		t.Fatalf("silent device should be offline, got %q", res.Status)
	}

	// After the scan, the next request restores the connection's own timeout.
	time.Sleep(100 * time.Millisecond)
	m.mu.Lock()
	_ = m.ensureLinkLocked()
	got := m.clientConfig.Timeout
	m.mu.Unlock()
	if got != 3*time.Second {
		t.Fatalf("timeout not restored after scan: %v", got)
	}
}
