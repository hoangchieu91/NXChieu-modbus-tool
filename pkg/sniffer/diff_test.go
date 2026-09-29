package sniffer

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDiffSnapshots(t *testing.T) {
	snapA := Snapshot{
		Frames: make([]CapturedFrame, 100),
		Health: HealthSnapshot{
			Score:            95,
			State:            "good",
			TotalFrames:      100,
			Requests:         50,
			Responses:        48,
			Exceptions:       1,
			Timeouts:         1,
			P95LatencyUS:     15000,
			AverageLatencyUS: 10000,
			Devices: []DeviceHealth{
				{UnitID: 1, State: "good", Requests: 25, Responses: 25, SuccessRate: 100.0, P95LatencyUS: 12000},
				{UnitID: 2, State: "good", Requests: 25, Responses: 23, Exceptions: 1, Timeouts: 1, SuccessRate: 92.0, P95LatencyUS: 18000},
			},
		},
	}

	snapB := Snapshot{
		Frames: make([]CapturedFrame, 120),
		Health: HealthSnapshot{
			Score:            65,
			State:            "fair",
			TotalFrames:      120,
			Requests:         60,
			Responses:        45,
			Exceptions:       5,
			Timeouts:         10,
			P95LatencyUS:     85000,
			AverageLatencyUS: 40000,
			Devices: []DeviceHealth{
				{UnitID: 1, State: "fair", Requests: 30, Responses: 20, Exceptions: 4, Timeouts: 6, SuccessRate: 66.7, P95LatencyUS: 90000},
				// Unit 2 is missing in B!
				// Unit 3 is newly added in B!
				{UnitID: 3, State: "good", Requests: 30, Responses: 25, Exceptions: 1, Timeouts: 4, SuccessRate: 83.3, P95LatencyUS: 45000},
			},
		},
	}

	diff := DiffSnapshots(snapA, snapB)

	if diff.HealthScoreDelta != -30 {
		t.Errorf("Expected delta -30, got %d", diff.HealthScoreDelta)
	}
	if len(diff.MissingDevices) != 1 || diff.MissingDevices[0] != 2 {
		t.Errorf("Expected missing device [2], got %v", diff.MissingDevices)
	}
	if len(diff.NewDevices) != 1 || diff.NewDevices[0] != 3 {
		t.Errorf("Expected new device [3], got %v", diff.NewDevices)
	}
	if len(diff.RegressedDevices) != 1 || diff.RegressedDevices[0] != 1 {
		t.Errorf("Expected regressed device [1], got %v", diff.RegressedDevices)
	}
	if diff.P95DeltaUS != 70000 {
		t.Errorf("Expected P95DeltaUS 70000, got %d", diff.P95DeltaUS)
	}
	if diff.Verdict == "" || diff.Summary == "" {
		t.Errorf("Verdict or Summary is empty: verdict=%q, summary=%q", diff.Verdict, diff.Summary)
	}
}

func TestDiffCaptureFiles(t *testing.T) {
	dir := t.TempDir()
	pathA := filepath.Join(dir, "capA.nxcap")
	pathB := filepath.Join(dir, "capB.nxcap")

	engineA := NewEngine(20)
	engineB := NewEngine(20)

	now := time.Now()
	// In capture A: Unit 1 query & response
	engineA.AddRaw("src", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, now)
	engineA.AddRaw("src", DirectionSlaveToMaster, rtu(1, 3, 2, 0, 10), QualityWire, now.Add(10*time.Millisecond))
	if err := SaveCapture(pathA, engineA.Snapshot(0)); err != nil {
		t.Fatalf("SaveCapture A failed: %v", err)
	}

	// In capture B: Unit 1 and Unit 5 query & response
	engineB.AddRaw("src", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, now)
	engineB.AddRaw("src", DirectionSlaveToMaster, rtu(1, 3, 2, 0, 10), QualityWire, now.Add(10*time.Millisecond))
	engineB.AddRaw("src", DirectionMasterToSlave, rtu(5, 3, 0, 0, 0, 1), QualityWire, now.Add(20*time.Millisecond))
	engineB.AddRaw("src", DirectionSlaveToMaster, rtu(5, 3, 2, 0, 20), QualityWire, now.Add(30*time.Millisecond))
	if err := SaveCapture(pathB, engineB.Snapshot(0)); err != nil {
		t.Fatalf("SaveCapture B failed: %v", err)
	}

	diffRes, err := DiffCaptureFiles(pathA, pathB)
	if err != nil {
		t.Fatalf("DiffCaptureFiles failed: %v", err)
	}

	if len(diffRes.NewDevices) != 1 || diffRes.NewDevices[0] != 5 {
		t.Errorf("Expected NewDevices [5], got %v", diffRes.NewDevices)
	}
	if len(diffRes.MissingDevices) != 0 {
		t.Errorf("Expected 0 missing devices, got %v", diffRes.MissingDevices)
	}
}
