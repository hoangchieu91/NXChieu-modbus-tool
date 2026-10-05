//go:build windows

package sniffer

import (
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

// End-to-end passive capture through Npcap's loopback adapter: a Modbus TCP master/slave pair
// talks on 127.0.0.1 and the analyzer must see correlated requests and responses. Skipped when
// Npcap or its loopback adapter is not available (CI, machines without Npcap).
func TestPassivePCAPCapturesLoopbackModbusTCP(t *testing.T) {
	devices, err := listPcapDevices()
	if err != nil {
		t.Skipf("Npcap not available: %v", err)
	}
	loopback := ""
	for _, d := range devices {
		if d.IsLoopback {
			loopback = d.Name
		}
	}
	if loopback == "" {
		t.Skip("Npcap loopback adapter not installed")
	}

	// A minimal Modbus TCP server answering FC03 with zeros.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := uint16(ln.Addr().(*net.TCPAddr).Port)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		req := make([]byte, 12)
		for {
			if _, err := io.ReadFull(conn, req); err != nil {
				return
			}
			qty := binary.BigEndian.Uint16(req[10:12])
			resp := make([]byte, 9+2*int(qty))
			copy(resp[0:2], req[0:2])
			binary.BigEndian.PutUint16(resp[4:6], uint16(3+2*int(qty)))
			resp[6], resp[7], resp[8] = req[6], 0x03, byte(2*qty)
			if _, err := conn.Write(resp); err != nil {
				return
			}
		}
	}()

	engine := NewEngine(100)
	m := NewSessionManager(engine)
	status, err := m.Start(CaptureConfig{Mode: ModePassivePCAP, InterfaceName: loopback, BPFFilter: "tcp port " + strconv.Itoa(int(port))})
	if err != nil {
		t.Skipf("cannot open the loopback adapter (permissions?): %v", err)
	}
	defer m.Stop()
	if !status.Running {
		t.Fatalf("capture not running: %+v", status)
	}
	time.Sleep(300 * time.Millisecond) // let the driver start delivering packets

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for i := uint16(1); i <= 3; i++ {
		req := tcpFrame(i, 1, 0x03, 0x00, 0x00, 0x00, 0x02)
		if _, err := conn.Write(req); err != nil {
			t.Fatal(err)
		}
		if _, err := io.ReadFull(conn, make([]byte, 13)); err != nil {
			t.Fatal(err)
		}
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		h := engine.Snapshot(0).Health
		if h.Requests >= 3 && h.Responses >= 3 {
			if h.OrphanResponses != 0 {
				t.Fatalf("responses not paired with requests: %+v", h)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("passive capture saw requests=%d responses=%d (status %+v)", h.Requests, h.Responses, m.Status())
		}
		time.Sleep(50 * time.Millisecond)
	}
}
