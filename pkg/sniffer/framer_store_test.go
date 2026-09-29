package sniffer

import (
	"bytes"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTCPFramerHandlesFragmentedAndCoalescedFrames(t *testing.T) {
	one := tcpFrame(1, 1, 3, 0, 0, 0, 1)
	two := tcpFrame(2, 2, 6, 0, 4, 0, 9)
	framer := NewStreamFramer(TransportTCP)
	if frames := framer.Feed(one[:4]); len(frames) != 0 {
		t.Fatalf("partial frame emitted: %d", len(frames))
	}
	frames := framer.Feed(append(one[4:], two...))
	if len(frames) != 2 || !bytes.Equal(frames[0], one) || !bytes.Equal(frames[1], two) {
		t.Fatalf("unexpected frames: %d", len(frames))
	}
}

func TestTCPProxyForwardsAndCapturesBothDirections(t *testing.T) {
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	response := tcpFrame(9, 1, 3, 2, 0, 7)
	go func() {
		conn, acceptErr := target.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		buffer := make([]byte, 12)
		_, _ = io.ReadFull(conn, buffer)
		_, _ = conn.Write(response)
	}()
	_, targetPortText, _ := net.SplitHostPort(target.Addr().String())
	targetPort, _ := strconv.Atoi(targetPortText)
	engine := NewEngine(20)
	manager := NewSessionManager(engine)
	status, err := manager.Start(CaptureConfig{Mode: ModeTCPProxy, ListenHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: uint16(targetPort)})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop()
	proxyAddress := status.ListenAddress
	if strings.HasPrefix(proxyAddress, "[::]") {
		proxyAddress = "127.0.0.1" + strings.TrimPrefix(proxyAddress, "[::]")
	}
	client, err := net.Dial("tcp", proxyAddress)
	if err != nil {
		t.Fatal(err)
	}
	request := tcpFrame(9, 1, 3, 0, 0, 0, 1)
	if _, err = client.Write(request); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len(response))
	if _, err = io.ReadFull(client, got); err != nil {
		t.Fatal(err)
	}
	_ = client.Close()
	if !bytes.Equal(got, response) {
		t.Fatal("proxy changed response bytes")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshot := engine.Snapshot(10)
		if len(snapshot.Frames) == 2 {
			if snapshot.Health.Requests != 1 || snapshot.Health.Responses != 1 || snapshot.Frames[1].ConversationID == "" {
				t.Fatalf("bad proxy correlation: %+v", snapshot.Health)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("proxy did not capture both frames")
}

func TestRTUFramerResynchronizesAfterNoise(t *testing.T) {
	one := rtu(1, 3, 0, 0, 0, 1)
	two := rtu(1, 3, 2, 0, 7)
	framer := NewStreamFramer(TransportRTU)
	frames := framer.Feed(append(append([]byte{0xff, 0xee}, one...), two...))
	if len(frames) == 0 {
		frames = append(frames, framer.FlushGap()...)
	}
	if len(frames) != 2 || !bytes.Equal(frames[0], one) || !bytes.Equal(frames[1], two) {
		t.Fatalf("failed to resynchronize: %d frame(s)", len(frames))
	}
}

func TestCaptureRoundTripAndCSV(t *testing.T) {
	engine := NewEngine(10)
	engine.AddRaw("test", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, time.Unix(100, 0))
	dir := t.TempDir()
	capturePath := filepath.Join(dir, "test.nxcap")
	if err := SaveCapture(capturePath, engine.Snapshot(0)); err != nil {
		t.Fatal(err)
	}
	frames, err := LoadCapture(capturePath)
	if err != nil || len(frames) != 1 || !bytes.Equal(frames[0].Raw, rtu(1, 3, 0, 0, 0, 1)) {
		t.Fatalf("round trip failed: %v %+v", err, frames)
	}
	csvPath := filepath.Join(dir, "test.csv")
	if err := ExportCSV(csvPath, engine.Snapshot(0)); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(csvPath)
	if err != nil || !bytes.Contains(data, []byte("FC03 Read Holding Registers")) {
		t.Fatalf("CSV missing decoded data: %v", err)
	}
}
