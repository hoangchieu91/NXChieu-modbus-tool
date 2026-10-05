package sniffer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCaptureStreamRoundTripKeepsProfileAndBaseline(t *testing.T) {
	catalog, err := LoadProfileCatalog([]byte(`{"name":"Plant","devices":{"1":{"unit_id":1,"registers":[{"address":0,"name":"V","data_type":"uint16"}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	src := NewEngine(100)
	src.SetProfileCatalog(catalog)
	now := time.Now()
	src.AddObserved("s", "internal", TransportRTU, DirectionMasterToSlave, rtuSeed(1, 3, 0, 0, 0, 1), QualityWire, now)
	src.AddObserved("s", "internal", TransportRTU, DirectionSlaveToMaster, rtuSeed(1, 3, 2, 0, 7), QualityWire, now.Add(5*time.Millisecond))
	path := filepath.Join(t.TempDir(), "a.nxcap")
	if err := SaveCaptureWithMetadata(path, src.Snapshot(0), catalog); err != nil {
		t.Fatal(err)
	}

	dst := NewEngine(100)
	meta, err := LoadCaptureInto(path, dst)
	if err != nil {
		t.Fatal(err)
	}
	snap := dst.Snapshot(0)
	if meta.FrameCount != 2 || len(snap.Frames) != 2 || snap.Health.Responses != 1 || snap.Health.OrphanResponses != 0 {
		t.Fatalf("meta=%+v health=%+v frames=%d", meta, snap.Health, len(snap.Frames))
	}
	if p := dst.GetProfileCatalog(); p == nil || p.Name != "Plant" {
		t.Fatal("embedded profile not restored")
	}
	if evs := snap.Frames[1].Parsed.EngineeringValues; len(evs) != 1 || evs[0].Name != "V" {
		t.Fatalf("profile not applied to restored frames: %+v", evs)
	}
}

// A file that breaks in the middle of the frames must not clear what is loaded now.
func TestBrokenCaptureLeavesAnalyzerUntouched(t *testing.T) {
	e := NewEngine(10)
	e.AddObserved("live", "internal", TransportRTU, DirectionMasterToSlave, rtuSeed(1, 3, 0, 0, 0, 1), QualityWire, time.Now())
	path := filepath.Join(t.TempDir(), "broken.nxcap")
	_ = os.WriteFile(path, []byte(`{"schema_version":2,"frames":[{"raw":"AQMAAAAB"},{"raw":`), 0o644)
	if _, err := LoadCaptureInto(path, e); err == nil {
		t.Fatal("broken capture accepted")
	}
	if n := len(e.Snapshot(0).Frames); n != 1 {
		t.Fatalf("analyzer changed by a failed load: %d frames", n)
	}
}

// Captures larger than the ring are streamed: only the newest frames are kept, the file is never
// held in memory as a whole.
func TestLargeCaptureStreamsIntoBoundedRing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "big.nxcap")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	enc := json.NewEncoder(f)
	_, _ = f.WriteString(`{"schema_version":2,"app":"test","frames":[`)
	const total = 120000
	frame := CapturedFrame{SourceID: "s", Transport: TransportRTU, Direction: DirectionMasterToSlave, CaptureQuality: QualityWire, Raw: rtuSeed(1, 3, 0, 0, 0, 1)}
	for i := 0; i < total; i++ {
		if i > 0 {
			_, _ = f.WriteString(",")
		}
		frame.CapturedAtUnixNS = int64(i) * int64(time.Millisecond)
		_ = enc.Encode(frame)
	}
	_, _ = f.WriteString(`]}`)
	_ = f.Close()

	e := NewEngine(50000)
	meta, err := LoadCaptureInto(path, e)
	if err != nil {
		t.Fatal(err)
	}
	if meta.FrameCount != total || len(e.Snapshot(0).Frames) != 50000 {
		t.Fatalf("frames read=%d kept=%d", meta.FrameCount, len(e.Snapshot(0).Frames))
	}
}
