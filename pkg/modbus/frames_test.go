package modbus

import (
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// recordingProxy forwards TCP traffic to target and records every chunk in each direction.
type recordingProxy struct {
	mu     sync.Mutex
	toDev  [][]byte
	toHost [][]byte
}

func (p *recordingProxy) last() (tx, rx []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.toDev) > 0 {
		tx = p.toDev[len(p.toDev)-1]
	}
	if len(p.toHost) > 0 {
		rx = p.toHost[len(p.toHost)-1]
	}
	return
}

func startRecordingProxy(t *testing.T, target string) (*recordingProxy, uint16) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	p := &recordingProxy{}
	pipe := func(dst, src net.Conn, record *[][]byte) {
		buf := make([]byte, 1024)
		for {
			n, err := src.Read(buf)
			if n > 0 {
				p.mu.Lock()
				*record = append(*record, append([]byte(nil), buf[:n]...))
				p.mu.Unlock()
				if _, werr := dst.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					_ = dst.Close()
				}
				return
			}
		}
	}
	go func() {
		for {
			host, err := ln.Accept()
			if err != nil {
				return
			}
			dev, err := net.Dial("tcp", target)
			if err != nil {
				_ = host.Close()
				return
			}
			go pipe(dev, host, &p.toDev)
			go pipe(host, dev, &p.toHost)
		}
	}()
	return p, uint16(ln.Addr().(*net.TCPAddr).Port)
}

// The sniffer must show exactly the bytes on the wire for Modbus TCP: MBAP header with the real
// transaction ID, no CRC, for normal responses and for exceptions.
func TestTrafficFramesMatchWireTCP(t *testing.T) {
	const slavePort = 5522
	slave := NewModbusSlaveServer("wire", nil)
	if err := slave.Start(SlaveConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: slavePort, SlaveID: 1}); err != nil {
		t.Fatal(err)
	}
	defer slave.Stop()
	time.Sleep(100 * time.Millisecond)

	proxy, port := startRecordingProxy(t, "127.0.0.1:5522")
	m := NewModbusClientWrapper()
	if _, err := m.Connect(ConnectionConfig{Type: "tcp", Host: "127.0.0.1", TcpPort: port, TimeoutMs: 1000}); err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect()

	cases := []PollDefinition{
		{SlaveID: 1, FunctionCode: 3, StartAddress: 0, Quantity: 3},
		{SlaveID: 1, FunctionCode: 1, StartAddress: 0, Quantity: 4},
		{SlaveID: 1, FunctionCode: 4, StartAddress: 1, Quantity: 2},
		{SlaveID: 9, FunctionCode: 3, StartAddress: 0, Quantity: 1}, // wrong unit -> exception 02
		{SlaveID: 1, FunctionCode: 3, StartAddress: 5, Quantity: 1},
	}
	for i, def := range cases {
		res := m.ExecuteRead(def)
		time.Sleep(20 * time.Millisecond) // let the proxy record the response chunk
		wireTx, wireRx := proxy.last()
		if res.RawTx != FormatHex(wireTx) {
			t.Fatalf("case %d TX mismatch\n sniffer: %s\n wire:    %s", i, res.RawTx, FormatHex(wireTx))
		}
		if res.RawRx != FormatHex(wireRx) {
			t.Fatalf("case %d RX mismatch (err=%q)\n sniffer: %s\n wire:    %s", i, res.Error, res.RawRx, FormatHex(wireRx))
		}
	}
}
