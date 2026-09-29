package sniffer

import (
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

const defaultCapacity = 10000

type deviceAccumulator struct {
	health      DeviceHealth
	latencies   []uint64
	lastRequest time.Time
}

// Engine is a bounded, thread-safe capture store with request/response correlation.
type Engine struct {
	mu                  sync.RWMutex
	frames              []CapturedFrame
	start               int
	count               int
	capacity            int
	sequence            uint64
	pending             map[string]pendingRequest
	devices             map[uint8]*deviceAccumulator
	health              HealthSnapshot
	latencies           []uint64
	baseline            BaselineProfile
	lastPollTime        map[uint8]time.Time
	devicePollIntervals map[uint8][]float64
	deviceLatencies     map[uint8][]uint64
	deviceFCs           map[uint8]map[uint8]bool
	profiles            *ProfileCatalog
}

func NewEngine(capacity int) *Engine {
	if capacity <= 0 {
		capacity = defaultCapacity
	}
	return &Engine{
		frames:              make([]CapturedFrame, capacity),
		capacity:            capacity,
		pending:             make(map[string]pendingRequest),
		devices:             make(map[uint8]*deviceAccumulator),
		baseline:            BaselineProfile{Mode: BaselineModeLearn, Devices: make(map[uint8]*DeviceBaseline)},
		lastPollTime:        make(map[uint8]time.Time),
		devicePollIntervals: make(map[uint8][]float64),
		deviceLatencies:     make(map[uint8][]uint64),
		deviceFCs:           make(map[uint8]map[uint8]bool),
	}
}

func ParseHex(value string) ([]byte, error) {
	compact := strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "", "-", "", ":", "").Replace(value)
	if compact == "" {
		return nil, fmt.Errorf("empty frame")
	}
	if len(compact)%2 != 0 {
		return nil, fmt.Errorf("hex frame has an odd number of digits")
	}
	raw, err := hex.DecodeString(compact)
	if err != nil {
		return nil, fmt.Errorf("invalid hex frame: %w", err)
	}
	return raw, nil
}

func (e *Engine) AddHex(sourceID string, direction Direction, value string, quality CaptureQuality) (CapturedFrame, error) {
	raw, err := ParseHex(value)
	if err != nil {
		return CapturedFrame{}, err
	}
	return e.AddRaw(sourceID, direction, raw, quality, time.Now()), nil
}

// AddHexPair records one completed request/response transaction using latency measured by the
// transport operation. Adding both frames here prevents callback scheduling time from becoming
// a misleading near-zero response time in the health dashboard.
func (e *Engine) AddHexPair(sourceID, requestHex, responseHex string, quality CaptureQuality, latency time.Duration) error {
	request, err := ParseHex(requestHex)
	if err != nil {
		return err
	}
	response, err := ParseHex(responseHex)
	if err != nil {
		return err
	}
	now := time.Now()
	e.AddRaw(sourceID, DirectionMasterToSlave, request, quality, now.Add(-latency))
	e.AddRaw(sourceID, DirectionSlaveToMaster, response, quality, now)
	return nil
}

// MarkTimedOut closes a request known by the caller to have completed without any response.
func (e *Engine) MarkTimedOut(sequence uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for key, pending := range e.pending {
		if pending.seq == sequence {
			e.timeoutPendingLocked(key, pending)
			return
		}
	}
}

func (e *Engine) AddRaw(sourceID string, direction Direction, raw []byte, quality CaptureQuality, capturedAt time.Time) CapturedFrame {
	return e.AddObserved(sourceID, "internal", detectTransport(raw), direction, raw, quality, capturedAt)
}

// AddObserved records one complete ADU supplied by a capture adapter.
func (e *Engine) AddObserved(sourceID, captureSource string, transport Transport, direction Direction, raw []byte, quality CaptureQuality, capturedAt time.Time) CapturedFrame {
	_, parsed, diagnostics := DecodeTransport(raw, transport, direction)
	e.mu.Lock()
	defer e.mu.Unlock()
	if direction == DirectionUnknown && parsed != nil {
		switch parsed.Kind {
		case "request":
			direction = DirectionMasterToSlave
		case "response", "exception":
			direction = DirectionSlaveToMaster
		default:
			probe := &CapturedFrame{SourceID: sourceID, Transport: transport, Parsed: parsed}
			if _, waiting := e.pending[correlationKey(probe)]; waiting {
				direction = DirectionSlaveToMaster
				parsed.Kind = "response"
			} else {
				direction = DirectionMasterToSlave
				parsed.Kind = "request"
			}
		}
	}

	e.sequence++
	frame := CapturedFrame{
		ID: fmt.Sprintf("frame-%d", e.sequence), Sequence: e.sequence,
		CapturedAtUnixNS: capturedAt.UnixNano(), Timestamp: capturedAt.Format("15:04:05.000"),
		SourceID: sourceID, Transport: transport, Direction: direction,
		CaptureSource: captureSource, CaptureQuality: quality,
		Raw: append([]byte(nil), raw...), Hex: strings.ToUpper(hex.EncodeToString(raw)),
		Parsed: parsed, Diagnostics: diagnostics,
	}
	frame.Hex = spacedHex(frame.Hex)

	e.health.TotalFrames++
	if hasRule(diagnostics, "MODBUS_MALFORMED") || hasRule(diagnostics, "TCP_BAD_MBAP") {
		e.health.MalformedFrames++
	}
	if hasRule(diagnostics, "RTU_BAD_CRC") {
		e.health.CRCErrorFrames++
	}
	if parsed != nil {
		e.correlate(&frame, capturedAt)
	}
	e.appendFrame(frame)
	return frame
}

// Replace restores a capture file into the bounded analyzer and recomputes correlation/health.
func (e *Engine) Replace(frames []CapturedFrame) {
	e.Clear()
	for _, frame := range frames {
		capturedAt := time.Unix(0, frame.CapturedAtUnixNS)
		if frame.CapturedAtUnixNS == 0 {
			capturedAt = time.Now()
		}
		e.AddObserved(frame.SourceID, frame.CaptureSource, frame.Transport, frame.Direction, frame.Raw, frame.CaptureQuality, capturedAt)
	}
}

func (e *Engine) correlate(frame *CapturedFrame, now time.Time) {
	d := frame.Parsed
	dev := e.devices[d.UnitID]
	if dev == nil {
		dev = &deviceAccumulator{health: DeviceHealth{UnitID: d.UnitID, State: "unknown"}}
		e.devices[d.UnitID] = dev
	}

	if d.Kind == "request" || frame.Direction == DirectionMasterToSlave {
		e.health.Requests++
		dev.health.Requests++
		dev.health.LastRequestAt = frame.Timestamp
		dev.lastRequest = now
		convID := fmt.Sprintf("tx-%d", frame.Sequence)
		frame.ConversationID = convID
		key := correlationKey(frame)
		if previous, waiting := e.pending[key]; waiting {
			e.health.Retries++
			dev.health.Retries++
			frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{RuleID: "MODBUS_RETRY", Severity: "warning", Scope: "device", Message: "Master lặp lại request khi request trước vẫn chưa có response", Recommendation: "Kiểm tra timeout của Master, tải bus và trạng thái thiết bị", Confidence: 90})
			e.timeoutPendingLocked(key, previous)
		}
		if d.FunctionCode == 5 || d.FunctionCode == 6 || d.FunctionCode == 15 || d.FunctionCode == 16 || d.FunctionCode == 22 || d.FunctionCode == 23 {
			frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{RuleID: "MODBUS_WRITE_OBSERVED", Severity: "info", Scope: "device", Message: "Phát hiện lệnh ghi dữ liệu Modbus", Recommendation: "Đối chiếu thao tác ghi với nhật ký vận hành nếu thay đổi không mong đợi", Confidence: 100})
		}
		if e.profiles != nil && d.Address != nil && len(d.Values) > 0 {
			d.EngineeringValues = e.profiles.DecodeEngineeringValues(d.UnitID, *d.Address, d.Values)
		}
		e.processBaselineRequest(frame, d, now)
		e.pending[key] = pendingRequest{frameID: frame.ID, convID: convID, seq: frame.Sequence, when: now, unitID: d.UnitID, fc: d.FunctionCode, address: d.Address}
		e.recomputeDevice(dev)
		return
	}

	if d.Kind != "response" && d.Kind != "exception" && frame.Direction != DirectionSlaveToMaster {
		return
	}
	e.health.Responses++
	dev.health.Responses++
	dev.health.LastResponseAt = frame.Timestamp
	if d.Kind == "exception" {
		e.health.Exceptions++
		dev.health.Exceptions++
	}
	key := correlationKey(frame)
	pending, ok := e.pending[key]
	if ok {
		delete(e.pending, key)
		frame.ConversationID = pending.convID
		if e.profiles != nil && pending.address != nil && len(d.Values) > 0 {
			d.EngineeringValues = e.profiles.DecodeEngineeringValues(d.UnitID, *pending.address, d.Values)
		}
		if now.After(pending.when) {
			frame.ResponseTimeUS = uint64(now.Sub(pending.when).Microseconds())
			e.latencies = appendBounded(e.latencies, frame.ResponseTimeUS, 4096)
			dev.latencies = appendBounded(dev.latencies, frame.ResponseTimeUS, 1024)
			if frame.ResponseTimeUS > 500000 {
				frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{RuleID: "MODBUS_SLOW_RESPONSE", Severity: "warning", Scope: "device", Message: "Response time vượt ngưỡng mặc định 500 ms", Recommendation: "So sánh với chu kỳ poll và baseline của thiết bị", Confidence: 95})
			}
			e.processBaselineResponse(frame, d, now)
		}
		e.updateConversation(pending.seq, pending.convID)
	} else {
		e.health.OrphanResponses++
		frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{RuleID: "MODBUS_ORPHAN_RESPONSE", Severity: "warning", Message: "Không tìm thấy request tương ứng trong capture", Confidence: 85})
	}
	e.recomputeDevice(dev)
}

func correlationKey(frame *CapturedFrame) string {
	if frame.Parsed == nil {
		return frame.SourceID
	}
	if frame.Transport == TransportTCP && frame.Parsed.TransactionID != nil {
		return fmt.Sprintf("tcp|%s|%d|%d", frame.SourceID, *frame.Parsed.TransactionID, frame.Parsed.UnitID)
	}
	return fmt.Sprintf("rtu|%s|%d", frame.SourceID, frame.Parsed.UnitID)
}

func (e *Engine) appendFrame(frame CapturedFrame) {
	if e.count < e.capacity {
		idx := (e.start + e.count) % e.capacity
		e.frames[idx] = frame
		e.count++
		return
	}
	e.frames[e.start] = frame
	e.start = (e.start + 1) % e.capacity
}

func (e *Engine) updateConversation(seq uint64, convID string) {
	for i := 0; i < e.count; i++ {
		idx := (e.start + e.count - 1 - i + e.capacity) % e.capacity
		if e.frames[idx].Sequence == seq {
			e.frames[idx].ConversationID = convID
			return
		}
	}
}

func (e *Engine) Snapshot(limit int) Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.expirePendingLocked(time.Now(), 5*time.Second)
	if limit <= 0 || limit > e.count {
		limit = e.count
	}
	frames := make([]CapturedFrame, limit)
	first := e.count - limit
	for i := 0; i < limit; i++ {
		idx := (e.start + first + i) % e.capacity
		frames[i] = cloneFrame(e.frames[idx])
	}
	health := e.health
	health.PendingRequests = len(e.pending)
	if len(e.latencies) > 0 {
		health.AverageLatencyUS = average(e.latencies)
		health.P95LatencyUS = percentile(e.latencies, 0.95)
	}
	health.Devices = make([]DeviceHealth, 0, len(e.devices))
	for _, d := range e.devices {
		h := d.health
		if !d.lastRequest.IsZero() && time.Since(d.lastRequest) > 30*time.Second && h.Responses > 0 {
			h.State = "not_polled"
		}
		if len(d.latencies) > 0 {
			h.AverageLatencyUS = average(d.latencies)
			h.P95LatencyUS = percentile(d.latencies, 0.95)
		}
		health.Devices = append(health.Devices, h)
	}
	sort.Slice(health.Devices, func(i, j int) bool { return health.Devices[i].UnitID < health.Devices[j].UnitID })
	health.Score, health.State = healthScore(health)
	return Snapshot{
		GeneratedAt: time.Now().Format(time.RFC3339Nano),
		Frames:      frames,
		Health:      health,
		Baseline:    e.snapshotBaselineLocked(),
	}
}

func (e *Engine) Clear() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.frames = make([]CapturedFrame, e.capacity)
	e.start, e.count, e.sequence = 0, 0, 0
	e.pending = make(map[string]pendingRequest)
	e.devices = make(map[uint8]*deviceAccumulator)
	e.health, e.latencies = HealthSnapshot{}, nil
	e.resetBaselineLocked()
}

func (e *Engine) SetBaselineMode(mode BaselineMode) BaselineProfile {
	e.mu.Lock()
	defer e.mu.Unlock()
	if mode == "" {
		mode = BaselineModeOff
	}
	e.baseline.Mode = mode
	if mode == BaselineModeMonitor && e.baseline.LearnedAt == "" {
		e.baseline.LearnedAt = time.Now().Format("15:04:05")
	}
	return e.snapshotBaselineLocked()
}

func (e *Engine) GetBaseline() BaselineProfile {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.snapshotBaselineLocked()
}

func (e *Engine) ResetBaseline() BaselineProfile {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.resetBaselineLocked()
	return e.snapshotBaselineLocked()
}

func (e *Engine) SetProfileCatalog(cat *ProfileCatalog) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.profiles = cat
}

func (e *Engine) GetProfileCatalog() *ProfileCatalog {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.profiles
}

func (e *Engine) resetBaselineLocked() {
	mode := e.baseline.Mode
	e.baseline = BaselineProfile{
		Mode:    mode,
		Devices: make(map[uint8]*DeviceBaseline),
	}
	e.lastPollTime = make(map[uint8]time.Time)
	e.devicePollIntervals = make(map[uint8][]float64)
	e.deviceLatencies = make(map[uint8][]uint64)
	e.deviceFCs = make(map[uint8]map[uint8]bool)
}

func (e *Engine) snapshotBaselineLocked() BaselineProfile {
	snap := BaselineProfile{
		Mode:         e.baseline.Mode,
		LearnedAt:    e.baseline.LearnedAt,
		SampleFrames: e.baseline.SampleFrames,
		Devices:      make(map[uint8]*DeviceBaseline, len(e.baseline.Devices)),
	}
	for k, v := range e.baseline.Devices {
		if v != nil {
			clone := *v
			clone.ObservedFunctionCodes = append([]uint8(nil), v.ObservedFunctionCodes...)
			snap.Devices[k] = &clone
		}
	}
	return snap
}

func (e *Engine) processBaselineRequest(frame *CapturedFrame, d *DecodedModbus, now time.Time) {
	if e.baseline.Mode == BaselineModeLearn {
		e.baseline.SampleFrames++
		if prev, ok := e.lastPollTime[d.UnitID]; ok && !prev.IsZero() {
			diffMS := float64(now.Sub(prev).Milliseconds())
			if diffMS >= 10 && diffMS <= 60000 {
				e.devicePollIntervals[d.UnitID] = appendBoundedFloat(e.devicePollIntervals[d.UnitID], diffMS, 200)
			}
		}
		e.lastPollTime[d.UnitID] = now
		if e.deviceFCs[d.UnitID] == nil {
			e.deviceFCs[d.UnitID] = make(map[uint8]bool)
		}
		e.deviceFCs[d.UnitID][d.FunctionCode] = true
		e.recomputeBaselineDeviceLocked(d.UnitID)
		return
	}

	if e.baseline.Mode == BaselineModeMonitor {
		baseDev, exists := e.baseline.Devices[d.UnitID]
		if !exists {
			frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{
				RuleID:         "BASELINE_NEW_DEVICE",
				Severity:       "info",
				Scope:          "device",
				Message:        fmt.Sprintf("Thiết bị Unit %d chưa từng xuất hiện trong giai đoạn học baseline", d.UnitID),
				Recommendation: "Kiểm tra xem đây có phải thiết bị mới được thêm vào bus hay không",
				Confidence:     90,
			})
		} else {
			if !containsUint8(baseDev.ObservedFunctionCodes, d.FunctionCode) {
				frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{
					RuleID:         "BASELINE_UNEXPECTED_FC",
					Severity:       "warning",
					Scope:          "device",
					Message:        fmt.Sprintf("Function code FC%02d chưa từng được ghi nhận trong baseline của Unit %d", d.FunctionCode, d.UnitID),
					Recommendation: "Kiểm tra xem Master có đang gửi lệnh bất thường hoặc bị lỗi chương trình",
					Confidence:     85,
				})
			}
			if prev, ok := e.lastPollTime[d.UnitID]; ok && !prev.IsZero() {
				diffMS := float64(now.Sub(prev).Milliseconds())
				if baseDev.MedianPollIntervalMS >= 20 && diffMS >= 10 {
					drift := math.Abs(diffMS - baseDev.MedianPollIntervalMS)
					if drift > baseDev.MedianPollIntervalMS*0.6 {
						frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{
							RuleID:         "RTU_POLL_PERIOD_DRIFT",
							Severity:       "warning",
							Scope:          "device",
							Message:        fmt.Sprintf("Chu kỳ poll Unit %d bị lệch: %.0f ms (baseline chuẩn: %.0f ms)", d.UnitID, diffMS, baseDev.MedianPollIntervalMS),
							Recommendation: "Kiểm tra tải trên bus, hàng đợi lệnh PLC hoặc tốc độ đáp ứng",
							Confidence:     80,
						})
					}
				}
			}
		}
		e.lastPollTime[d.UnitID] = now
	}
}

func (e *Engine) processBaselineResponse(frame *CapturedFrame, d *DecodedModbus, now time.Time) {
	if e.baseline.Mode == BaselineModeLearn {
		if frame.ResponseTimeUS > 0 {
			e.deviceLatencies[d.UnitID] = appendBounded(e.deviceLatencies[d.UnitID], frame.ResponseTimeUS, 200)
			e.recomputeBaselineDeviceLocked(d.UnitID)
		}
		return
	}

	if e.baseline.Mode == BaselineModeMonitor {
		if baseDev, exists := e.baseline.Devices[d.UnitID]; exists && baseDev.P95LatencyUS > 0 {
			if frame.ResponseTimeUS > baseDev.P95LatencyUS*2 {
				frame.Diagnostics = append(frame.Diagnostics, DiagnosticItem{
					RuleID:         "MODBUS_SLOW_RESPONSE",
					Severity:       "warning",
					Scope:          "device",
					Message:        fmt.Sprintf("Response time Unit %d (%s) vượt quá 2x P95 baseline (%s)", d.UnitID, formatLatencyUS(frame.ResponseTimeUS), formatLatencyUS(baseDev.P95LatencyUS)),
					Recommendation: "So sánh với chu kỳ poll và tải thực tế của thiết bị",
					Confidence:     90,
				})
			}
		}
	}
}

func (e *Engine) recomputeBaselineDeviceLocked(unitID uint8) {
	dev := e.baseline.Devices[unitID]
	if dev == nil {
		dev = &DeviceBaseline{UnitID: unitID}
		e.baseline.Devices[unitID] = dev
	}
	dev.SampleCount++
	intervals := e.devicePollIntervals[unitID]
	if len(intervals) > 0 {
		dev.MedianPollIntervalMS = medianFloat(intervals)
	}
	lats := e.deviceLatencies[unitID]
	if len(lats) > 0 {
		dev.P50LatencyUS = percentile(lats, 0.50)
		dev.P95LatencyUS = percentile(lats, 0.95)
	}
	if fcMap := e.deviceFCs[unitID]; len(fcMap) > 0 {
		dev.ObservedFunctionCodes = make([]uint8, 0, len(fcMap))
		for fc := range fcMap {
			dev.ObservedFunctionCodes = append(dev.ObservedFunctionCodes, fc)
		}
		sort.Slice(dev.ObservedFunctionCodes, func(i, j int) bool {
			return dev.ObservedFunctionCodes[i] < dev.ObservedFunctionCodes[j]
		})
	}
}

func (e *Engine) expirePendingLocked(now time.Time, timeout time.Duration) {
	for key, pending := range e.pending {
		if now.Sub(pending.when) >= timeout {
			e.timeoutPendingLocked(key, pending)
		}
	}
}

func (e *Engine) timeoutPendingLocked(key string, pending pendingRequest) {
	delete(e.pending, key)
	e.health.Timeouts++
	if dev := e.devices[pending.unitID]; dev != nil {
		dev.health.Timeouts++
		e.recomputeDevice(dev)
	}
	for i := 0; i < e.count; i++ {
		idx := (e.start + e.count - 1 - i + e.capacity) % e.capacity
		if e.frames[idx].Sequence == pending.seq {
			e.frames[idx].Diagnostics = append(e.frames[idx].Diagnostics, DiagnosticItem{
				RuleID: "MODBUS_NO_RESPONSE", Severity: "error",
				Message: "Request đã được gửi nhưng không nhận được response", Confidence: 95,
			})
			return
		}
	}
}

func (e *Engine) recomputeDevice(d *deviceAccumulator) {
	if d.health.Requests > 0 {
		d.health.SuccessRate = float64(d.health.Responses-d.health.Exceptions) / float64(d.health.Requests) * 100
	}
	switch {
	case d.health.Requests < 3 && d.health.Responses == 0:
		d.health.State = "unknown"
	case d.health.Timeouts >= 5 && d.health.SuccessRate < 25:
		d.health.State = "offline"
	case d.health.Requests >= 3 && d.health.Responses*2 < d.health.Requests:
		d.health.State = "suspected_offline"
	case d.health.Exceptions > 0 || d.health.Responses < d.health.Requests:
		d.health.State = "degraded"
	default:
		d.health.State = "healthy"
	}
}

func healthScore(h HealthSnapshot) (int, string) {
	if h.TotalFrames == 0 {
		return 0, "unknown"
	}
	score := 100
	score -= minInt(35, int(h.CRCErrorFrames*12))
	score -= minInt(30, int(h.MalformedFrames*10))
	score -= minInt(20, int(h.OrphanResponses*5))
	score -= minInt(20, int(h.Exceptions*3))
	score -= minInt(35, int(h.Timeouts*8))
	score -= minInt(15, int(h.Retries*3))
	if h.Requests >= 3 && h.Responses*2 < h.Requests {
		score -= 25
	}
	if score < 0 {
		score = 0
	}
	state := "healthy"
	if score < 60 {
		state = "critical"
	} else if score < 85 {
		state = "degraded"
	}
	return score, state
}

func percentile(values []uint64, p float64) uint64 {
	if len(values) == 0 {
		return 0
	}
	copyValues := append([]uint64(nil), values...)
	sort.Slice(copyValues, func(i, j int) bool { return copyValues[i] < copyValues[j] })
	idx := int(float64(len(copyValues)-1) * p)
	return copyValues[idx]
}

func average(values []uint64) uint64 {
	var sum uint64
	for _, value := range values {
		sum += value
	}
	return sum / uint64(len(values))
}

func appendBounded(values []uint64, value uint64, max int) []uint64 {
	values = append(values, value)
	if len(values) > max {
		values = append([]uint64(nil), values[len(values)-max:]...)
	}
	return values
}

func cloneFrame(frame CapturedFrame) CapturedFrame {
	frame.Raw = append([]byte(nil), frame.Raw...)
	frame.Diagnostics = append([]DiagnosticItem(nil), frame.Diagnostics...)
	if frame.Parsed != nil {
		p := *frame.Parsed
		p.Values = append([]uint16(nil), p.Values...)
		p.Bits = append([]bool(nil), p.Bits...)
		p.WriteValues = append([]uint16(nil), p.WriteValues...)
		p.EngineeringValues = append([]EngineeringValue(nil), p.EngineeringValues...)
		frame.Parsed = &p
	}
	return frame
}

func hasRule(items []DiagnosticItem, rule string) bool {
	for _, item := range items {
		if item.RuleID == rule {
			return true
		}
	}
	return false
}

func spacedHex(compact string) string {
	var b strings.Builder
	for i := 0; i < len(compact); i += 2 {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(compact[i : i+2])
	}
	return b.String()
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func appendBoundedFloat(values []float64, value float64, max int) []float64 {
	values = append(values, value)
	if len(values) > max {
		values = append([]float64(nil), values[len(values)-max:]...)
	}
	return values
}

func medianFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	copyVals := append([]float64(nil), values...)
	sort.Float64s(copyVals)
	n := len(copyVals)
	if n%2 != 0 {
		return copyVals[n/2]
	}
	return (copyVals[n/2-1] + copyVals[n/2]) / 2.0
}

func containsUint8(slice []uint8, val uint8) bool {
	for _, v := range slice {
		if v == val {
			return true
		}
	}
	return false
}

func formatLatencyUS(us uint64) string {
	if us < 1000 {
		return fmt.Sprintf("%d µs", us)
	}
	return fmt.Sprintf("%.2f ms", float64(us)/1000.0)
}
