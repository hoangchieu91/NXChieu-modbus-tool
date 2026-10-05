package sniffer

import (
	"encoding/json"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// "Read 2 registers at address 0" also has the shape of an MBAP header; it is RTU.
func TestDetectTransportPrefersValidRTUCRC(t *testing.T) {
	transport, decoded, _ := Decode(rtuSeed(1, 0x03, 0x00, 0x00, 0x00, 0x02), DirectionMasterToSlave)
	if transport != TransportRTU || decoded == nil || decoded.FunctionCode != 3 {
		t.Fatalf("got transport=%s decoded=%+v", transport, decoded)
	}
}

func passive(e *Engine, raw []byte, at time.Time) CapturedFrame {
	return e.AddObserved("serial:COM9", "passive_serial", TransportRTU, DirectionUnknown, raw, QualityWire, at)
}

// FC01 responses with 3 data bytes are 5 bytes long, like a request.
func TestPassiveFC01ResponseWithThreeDataBytes(t *testing.T) {
	e := NewEngine(50)
	now := time.Now()
	passive(e, rtuSeed(1, 0x01, 0x00, 0x00, 0x00, 0x14), now)
	resp := passive(e, rtuSeed(1, 0x01, 0x03, 0xAA, 0x55, 0x0F), now.Add(20*time.Millisecond))
	h := e.Snapshot(10).Health
	if resp.Direction != DirectionSlaveToMaster || h.Requests != 1 || h.Responses != 1 || h.Retries != 0 {
		t.Fatalf("direction=%s health=%+v", resp.Direction, h)
	}
}

func TestPassiveFC23Response(t *testing.T) {
	e := NewEngine(50)
	now := time.Now()
	passive(e, rtuSeed(1, 0x17, 0x00, 0x00, 0x00, 0x04, 0x00, 0x0A, 0x00, 0x01, 0x02, 0x00, 0x07), now)
	resp := passive(e, rtuSeed(1, 0x17, 0x08, 0, 1, 0, 2, 0, 3, 0, 4), now.Add(20*time.Millisecond))
	h := e.Snapshot(10).Health
	if resp.Direction != DirectionSlaveToMaster || h.Requests != 1 || h.Responses != 1 {
		t.Fatalf("direction=%s health=%+v", resp.Direction, h)
	}
}

// For echo function codes a lost response must not shift every later request/response pair.
func TestPassiveEchoLostResponseDoesNotMisalign(t *testing.T) {
	e := NewEngine(50)
	now := time.Now()
	passive(e, rtuSeed(1, 0x06, 0x00, 0x01, 0x00, 0x01), now) // request A, response lost
	b := passive(e, rtuSeed(1, 0x06, 0x00, 0x02, 0x00, 0x02), now.Add(100*time.Millisecond))
	echo := passive(e, rtuSeed(1, 0x06, 0x00, 0x02, 0x00, 0x02), now.Add(120*time.Millisecond))
	if b.Direction != DirectionMasterToSlave || echo.Direction != DirectionSlaveToMaster {
		t.Fatalf("B=%s echo=%s", b.Direction, echo.Direction)
	}
	if echo.ConversationID == "" || echo.ConversationID != b.ConversationID {
		t.Fatalf("echo paired with %q, want B's %q", echo.ConversationID, b.ConversationID)
	}
}

// Requests that are never answered (masters reconnecting to a dead slave) must not grow the
// pending map without bound.
func TestPendingRequestsAreBounded(t *testing.T) {
	e := NewEngine(100)
	now := time.Now()
	for i := 0; i < maxPendingRequests+500; i++ {
		src := "proxy:10.0.0.1:" + strconv.Itoa(1000+i)
		e.AddObserved(src, "proxy", TransportTCP, DirectionMasterToSlave, tcpFrame(uint16(i), 1, 3, 0, 0, 0, 1), QualityWire, now)
	}
	e.mu.Lock()
	n := len(e.pending)
	e.mu.Unlock()
	if n > maxPendingRequests {
		t.Fatalf("%d pending requests kept (limit %d)", n, maxPendingRequests)
	}
}

// Replaying an old capture must expire requests by capture time, not wall-clock time.
func TestReplayedCaptureCorrelatesByCaptureTime(t *testing.T) {
	live := NewEngine(50)
	old := time.Now().Add(-2 * time.Hour)
	live.AddObserved("s", "internal", TransportRTU, DirectionMasterToSlave, rtuSeed(1, 3, 0, 0, 0, 1), QualityWire, old)
	live.AddObserved("s", "internal", TransportRTU, DirectionSlaveToMaster, rtuSeed(1, 3, 2, 0, 7), QualityWire, old.Add(30*time.Millisecond))

	replay := NewEngine(50)
	replay.Replace(live.Snapshot(10).Frames)
	h := replay.Snapshot(10).Health
	if h.Timeouts != 0 || h.OrphanResponses != 0 || h.Responses != 1 {
		t.Fatalf("replayed capture mis-correlated: %+v", h)
	}
}

// A float register reading FFFF FFFF (NaN) must not make snapshots unserializable.
func TestNaNEngineeringValueKeepsSnapshotSerializable(t *testing.T) {
	catalog, err := LoadProfileCatalog([]byte(`{"devices":{"1":{"unit_id":1,"device_name":"PM","registers":[{"address":0,"name":"V","data_type":"float32_abcd","scale":1,"unit":"V"}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	e := NewEngine(50)
	e.SetProfileCatalog(catalog)
	now := time.Now()
	e.AddObserved("s", "internal", TransportRTU, DirectionMasterToSlave, rtuSeed(1, 3, 0, 0, 0, 2), QualityWire, now)
	e.AddObserved("s", "internal", TransportRTU, DirectionSlaveToMaster, rtuSeed(1, 3, 4, 0xFF, 0xFF, 0xFF, 0xFF), QualityWire, now.Add(10*time.Millisecond))
	data, err := json.Marshal(e.Snapshot(10))
	if err != nil {
		t.Fatalf("snapshot cannot be sent to the UI: %v", err)
	}
	if !strings.Contains(string(data), `"NaN"`) {
		t.Fatalf("NaN reading should be shown as text: %s", data)
	}
}

// FC23 responses carry the read range; re-applying profiles must map them there.
func TestProfileReapplyMapsFC23ResponseToReadAddress(t *testing.T) {
	catalog, err := LoadProfileCatalog([]byte(`{"devices":{"1":{"unit_id":1,"registers":[{"address":0,"name":"R0","data_type":"uint16"},{"address":100,"name":"W100","data_type":"uint16"}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	e := NewEngine(50)
	now := time.Now()
	e.AddObserved("s", "internal", TransportRTU, DirectionMasterToSlave, rtuSeed(1, 0x17, 0, 0, 0, 1, 0, 100, 0, 1, 2, 0, 9), QualityWire, now)
	e.AddObserved("s", "internal", TransportRTU, DirectionSlaveToMaster, rtuSeed(1, 0x17, 2, 0, 7), QualityWire, now.Add(10*time.Millisecond))
	e.SetProfileCatalog(catalog)
	frames := e.Snapshot(10).Frames
	evs := frames[len(frames)-1].Parsed.EngineeringValues
	if len(evs) != 1 || evs[0].Name != "R0" {
		t.Fatalf("FC23 response mapped to %+v, want R0", evs)
	}
}

// Concurrent Starts used to orphan a listener, after which Stop blocked forever.
func TestConcurrentStartThenStopReturns(t *testing.T) {
	m := NewSessionManager(NewEngine(10))
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = m.Start(CaptureConfig{Mode: ModeTCPProxy, ListenHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: 9})
		}()
	}
	wg.Wait()
	done := make(chan struct{})
	go func() { m.Stop(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Stop did not return after concurrent Starts")
	}
}

func TestProxyRejectsTargetingItself(t *testing.T) {
	m := NewSessionManager(NewEngine(10))
	if _, err := m.Start(CaptureConfig{Mode: ModeTCPProxy, ListenPort: 15502, TargetHost: "127.0.0.1", TargetPort: 15502}); err == nil {
		m.Stop()
		t.Fatal("proxy pointing at itself must be rejected")
	}
}

// A master that half-closes after its request must still receive the reply.
func TestProxyDeliversReplyAfterClientHalfClose(t *testing.T) {
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	response := tcpFrame(9, 1, 3, 2, 0, 7)
	go func() {
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 12)
		_, _ = io.ReadFull(conn, buf)
		time.Sleep(100 * time.Millisecond) // reply arrives after the client's EOF
		_, _ = conn.Write(response)
	}()
	_, portText, _ := net.SplitHostPort(target.Addr().String())
	port, _ := strconv.Atoi(portText)
	m := NewSessionManager(NewEngine(20))
	status, err := m.Start(CaptureConfig{Mode: ModeTCPProxy, ListenHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: uint16(port)})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Stop()

	client, err := net.Dial("tcp", status.ListenAddress)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.Write(tcpFrame(9, 1, 3, 0, 0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	_ = client.(*net.TCPConn).CloseWrite()
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	got := make([]byte, len(response))
	if _, err := io.ReadFull(client, got); err != nil {
		t.Fatalf("reply lost after half-close: %v", err)
	}
}

func TestProfileRegisterTables(t *testing.T) {
	legacy, err := LoadProfileCatalog([]byte(`{"devices":{"1":{"unit_id":1,"registers":[{"address":5,"name":"T","data_type":"uint16"}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	// Profiles without "table" keep working for both register tables.
	if len(legacy.DecodeForFunction(1, 3, 5, []uint16{7})) != 1 || len(legacy.DecodeForFunction(1, 4, 5, []uint16{7})) != 1 {
		t.Fatal("legacy profile must map FC03 and FC04")
	}
	// Coil writes (FC05 value 0xFF00) are never register values.
	if evs := legacy.DecodeForFunction(1, 5, 5, []uint16{0xFF00}); len(evs) != 0 {
		t.Fatalf("FC05 mapped as a register: %+v", evs)
	}

	split, err := LoadProfileCatalog([]byte(`{"devices":{"1":{"unit_id":1,"registers":[
		{"address":0,"name":"Setpoint","data_type":"uint16","table":"holding"},
		{"address":0,"name":"Measured","data_type":"uint16","table":"input"}]}}}`))
	if err != nil {
		t.Fatalf("same address in two tables must be allowed: %v", err)
	}
	if evs := split.DecodeForFunction(1, 3, 0, []uint16{1}); len(evs) != 1 || evs[0].Name != "Setpoint" {
		t.Fatalf("FC03 mapped to %+v, want Setpoint", evs)
	}
	if evs := split.DecodeForFunction(1, 4, 0, []uint16{1}); len(evs) != 1 || evs[0].Name != "Measured" {
		t.Fatalf("FC04 mapped to %+v, want Measured", evs)
	}

	if _, err := LoadProfileCatalog([]byte(`{"devices":{"1":{"unit_id":1,"registers":[{"address":0,"name":"X","data_type":"uint16","table":"coils"}]}}}`)); err == nil {
		t.Fatal("unknown table must be rejected")
	}
}
