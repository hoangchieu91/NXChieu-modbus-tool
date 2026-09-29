package sniffer

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// DeviceDiff compares metrics for a single Modbus unit between two captures.
type DeviceDiff struct {
	UnitID           uint8   `json:"unit_id"`
	Status           string  `json:"status"` // "new", "missing", "regressed", "improved", "unchanged"
	HealthScoreA     int     `json:"health_score_a"`
	HealthScoreB     int     `json:"health_score_b"`
	ScoreDelta       int     `json:"score_delta"`
	RequestsA        uint64  `json:"requests_a"`
	RequestsB        uint64  `json:"requests_b"`
	SuccessRateA     float64 `json:"success_rate_a"`
	SuccessRateB     float64 `json:"success_rate_b"`
	SuccessRateDelta float64 `json:"success_rate_delta"`
	P95LatencyUSA    uint64  `json:"p95_latency_us_a"`
	P95LatencyUSB    uint64  `json:"p95_latency_us_b"`
	LatencyDeltaUS   int64   `json:"latency_delta_us"`
	Remarks          string  `json:"remarks"`
}

// CaptureDiffResult summarizes the comparative analysis between two captures (A: baseline/before, B: target/after).
type CaptureDiffResult struct {
	TotalFramesA     int          `json:"total_frames_a"`
	TotalFramesB     int          `json:"total_frames_b"`
	HealthScoreA     int          `json:"health_score_a"`
	HealthScoreB     int          `json:"health_score_b"`
	HealthScoreDelta int          `json:"health_score_delta"`
	BusStateA        string       `json:"bus_state_a"`
	BusStateB        string       `json:"bus_state_b"`
	P95LatencyUSA    uint64       `json:"p95_latency_us_a"`
	P95LatencyUSB    uint64       `json:"p95_latency_us_b"`
	P95DeltaUS       int64        `json:"p95_delta_us"`
	ErrorRateA       float64      `json:"error_rate_a"`
	ErrorRateB       float64      `json:"error_rate_b"`
	ErrorRateDelta   float64      `json:"error_rate_delta"`
	TimeoutCountA    uint64       `json:"timeout_count_a"`
	TimeoutCountB    uint64       `json:"timeout_count_b"`
	NewDevices       []uint8      `json:"new_devices"`
	MissingDevices   []uint8      `json:"missing_devices"`
	RegressedDevices []uint8      `json:"regressed_devices"`
	ImprovedDevices  []uint8      `json:"improved_devices"`
	DeviceDiffs      []DeviceDiff `json:"device_diffs"`
	Verdict          string       `json:"verdict"`
	Summary          string       `json:"summary"`
}

// DiffSnapshots compares two snapshot structures directly.
func DiffSnapshots(snapA, snapB Snapshot) CaptureDiffResult {
	res := CaptureDiffResult{
		TotalFramesA:     len(snapA.Frames),
		TotalFramesB:     len(snapB.Frames),
		HealthScoreA:     snapA.Health.Score,
		HealthScoreB:     snapB.Health.Score,
		HealthScoreDelta: snapB.Health.Score - snapA.Health.Score,
		BusStateA:        snapA.Health.State,
		BusStateB:        snapB.Health.State,
		P95LatencyUSA:    snapA.Health.P95LatencyUS,
		P95LatencyUSB:    snapB.Health.P95LatencyUS,
		P95DeltaUS:       int64(snapB.Health.P95LatencyUS) - int64(snapA.Health.P95LatencyUS),
		TimeoutCountA:    snapA.Health.Timeouts,
		TimeoutCountB:    snapB.Health.Timeouts,
	}

	if snapA.Health.Requests > 0 {
		errA := snapA.Health.Exceptions + snapA.Health.Timeouts + snapA.Health.CRCErrorFrames
		res.ErrorRateA = float64(errA) / float64(snapA.Health.Requests) * 100.0
	}
	if snapB.Health.Requests > 0 {
		errB := snapB.Health.Exceptions + snapB.Health.Timeouts + snapB.Health.CRCErrorFrames
		res.ErrorRateB = float64(errB) / float64(snapB.Health.Requests) * 100.0
	}
	res.ErrorRateDelta = res.ErrorRateB - res.ErrorRateA

	devMapA := make(map[uint8]DeviceHealth, len(snapA.Health.Devices))
	for _, dev := range snapA.Health.Devices {
		devMapA[dev.UnitID] = dev
	}
	devMapB := make(map[uint8]DeviceHealth, len(snapB.Health.Devices))
	for _, dev := range snapB.Health.Devices {
		devMapB[dev.UnitID] = dev
	}

	allUnitsMap := make(map[uint8]struct{})
	for uid := range devMapA {
		allUnitsMap[uid] = struct{}{}
	}
	for uid := range devMapB {
		allUnitsMap[uid] = struct{}{}
	}

	allUnits := make([]uint8, 0, len(allUnitsMap))
	for uid := range allUnitsMap {
		allUnits = append(allUnits, uid)
	}
	sort.Slice(allUnits, func(i, j int) bool { return allUnits[i] < allUnits[j] })

	for _, uid := range allUnits {
		dA, inA := devMapA[uid]
		dB, inB := devMapB[uid]

		diff := DeviceDiff{UnitID: uid}
		if inA && !inB {
			diff.Status = "missing"
			diff.HealthScoreA = calculateDeviceScore(dA)
			diff.RequestsA = dA.Requests
			diff.SuccessRateA = dA.SuccessRate
			diff.P95LatencyUSA = dA.P95LatencyUS
			diff.Remarks = fmt.Sprintf("Thiết bị Unit %d có trong Capture A nhưng vắng mặt hoàn toàn trong Capture B", uid)
			res.MissingDevices = append(res.MissingDevices, uid)
		} else if !inA && inB {
			diff.Status = "new"
			diff.HealthScoreB = calculateDeviceScore(dB)
			diff.RequestsB = dB.Requests
			diff.SuccessRateB = dB.SuccessRate
			diff.P95LatencyUSB = dB.P95LatencyUS
			diff.Remarks = fmt.Sprintf("Thiết bị Unit %d mới xuất hiện trong Capture B", uid)
			res.NewDevices = append(res.NewDevices, uid)
		} else {
			diff.HealthScoreA = calculateDeviceScore(dA)
			diff.HealthScoreB = calculateDeviceScore(dB)
			diff.ScoreDelta = diff.HealthScoreB - diff.HealthScoreA
			diff.RequestsA = dA.Requests
			diff.RequestsB = dB.Requests
			diff.SuccessRateA = dA.SuccessRate
			diff.SuccessRateB = dB.SuccessRate
			diff.SuccessRateDelta = dB.SuccessRate - dA.SuccessRate
			diff.P95LatencyUSA = dA.P95LatencyUS
			diff.P95LatencyUSB = dB.P95LatencyUS
			diff.LatencyDeltaUS = int64(dB.P95LatencyUS) - int64(dA.P95LatencyUS)

			var remarks []string
			if diff.ScoreDelta <= -15 || diff.SuccessRateDelta <= -10.0 {
				diff.Status = "regressed"
				res.RegressedDevices = append(res.RegressedDevices, uid)
				remarks = append(remarks, fmt.Sprintf("Sức khỏe suy giảm (Score Δ %d, Tỷ lệ thành công Δ %.1f%%)", diff.ScoreDelta, diff.SuccessRateDelta))
			} else if diff.ScoreDelta >= 15 || diff.SuccessRateDelta >= 10.0 {
				diff.Status = "improved"
				res.ImprovedDevices = append(res.ImprovedDevices, uid)
				remarks = append(remarks, fmt.Sprintf("Sức khỏe cải thiện rõ rệt (Score Δ +%d, Tỷ lệ thành công Δ +%.1f%%)", diff.ScoreDelta, diff.SuccessRateDelta))
			} else {
				diff.Status = "unchanged"
				remarks = append(remarks, "Hoạt động tương đương, không có thay đổi đáng kể")
			}
			if diff.LatencyDeltaUS > 20000 {
				remarks = append(remarks, fmt.Sprintf("Độ trễ P95 tăng thêm +%s", formatLatencyUS(uint64(diff.LatencyDeltaUS))))
			} else if diff.LatencyDeltaUS < -20000 {
				remarks = append(remarks, fmt.Sprintf("Độ trễ P95 giảm -%s", formatLatencyUS(uint64(-diff.LatencyDeltaUS))))
			}
			diff.Remarks = strings.Join(remarks, ". ")
		}
		res.DeviceDiffs = append(res.DeviceDiffs, diff)
	}

	// Determine overall verdict
	switch {
	case len(res.MissingDevices) > 0 && res.HealthScoreDelta < 0:
		res.Verdict = "Suy giảm (Warning - Mất thiết bị & Giảm điểm)"
	case res.HealthScoreDelta <= -10 || res.ErrorRateDelta >= 5.0:
		res.Verdict = "Suy giảm (Regressed)"
	case res.HealthScoreDelta >= 10 || res.ErrorRateDelta <= -5.0:
		res.Verdict = "Cải thiện (Improved)"
	default:
		res.Verdict = "Ổn định (Stable)"
	}

	var summaryParts []string
	summaryParts = append(summaryParts, fmt.Sprintf("Điểm sức khỏe: %d -> %d (Δ %+d)", res.HealthScoreA, res.HealthScoreB, res.HealthScoreDelta))
	summaryParts = append(summaryParts, fmt.Sprintf("Tỷ lệ lỗi bus: %.2f%% -> %.2f%% (Δ %+.2f%%)", res.ErrorRateA, res.ErrorRateB, res.ErrorRateDelta))
	if len(res.MissingDevices) > 0 {
		summaryParts = append(summaryParts, fmt.Sprintf("Thiết bị rớt mạng (%d): Unit %v", len(res.MissingDevices), res.MissingDevices))
	}
	if len(res.NewDevices) > 0 {
		summaryParts = append(summaryParts, fmt.Sprintf("Thiết bị mới phát hiện (%d): Unit %v", len(res.NewDevices), res.NewDevices))
	}
	if len(res.RegressedDevices) > 0 {
		summaryParts = append(summaryParts, fmt.Sprintf("Thiết bị suy giảm (%d): Unit %v", len(res.RegressedDevices), res.RegressedDevices))
	}
	res.Summary = strings.Join(summaryParts, " | ")

	return res
}

// DiffCaptureFiles loads two capture files from disk, reconstructs snapshots and computes their diff.
func DiffCaptureFiles(pathA, pathB string) (*CaptureDiffResult, error) {
	framesA, err := LoadCapture(pathA)
	if err != nil {
		return nil, fmt.Errorf("load capture A (%s): %w", pathA, err)
	}
	framesB, err := LoadCapture(pathB)
	if err != nil {
		return nil, fmt.Errorf("load capture B (%s): %w", pathB, err)
	}

	snapA := snapshotFromFrames(framesA)
	snapB := snapshotFromFrames(framesB)

	diff := DiffSnapshots(snapA, snapB)
	return &diff, nil
}

func snapshotFromFrames(frames []CapturedFrame) Snapshot {
	engine := NewEngine(len(frames) + 10)
	for _, f := range frames {
		t := time.Unix(0, f.CapturedAtUnixNS)
		engine.AddObserved(f.SourceID, f.CaptureSource, f.Transport, f.Direction, f.Raw, f.CaptureQuality, t)
	}
	return engine.Snapshot(0)
}

func calculateDeviceScore(dev DeviceHealth) int {
	if dev.Requests == 0 {
		return 100
	}
	score := 100
	errRate := float64(dev.Exceptions+dev.Timeouts) / float64(dev.Requests) * 100.0
	score -= int(errRate * 0.8)
	if dev.P95LatencyUS > 100000 { // > 100ms
		score -= 15
	} else if dev.P95LatencyUS > 50000 { // > 50ms
		score -= 5
	}
	if score < 0 {
		score = 0
	}
	return score
}
