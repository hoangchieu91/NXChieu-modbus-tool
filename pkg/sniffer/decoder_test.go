package sniffer

import (
	"encoding/binary"
	"testing"
	"time"
)

func rtu(payload ...byte) []byte {
	crc := crc16(payload)
	return append(payload, byte(crc), byte(crc>>8))
}

func tcpFrame(txn uint16, unit byte, pdu ...byte) []byte {
	raw := make([]byte, 7+len(pdu))
	binary.BigEndian.PutUint16(raw[0:2], txn)
	binary.BigEndian.PutUint16(raw[4:6], uint16(1+len(pdu)))
	raw[6] = unit
	copy(raw[7:], pdu)
	return raw
}

func TestDecodeRTUReadPair(t *testing.T) {
	req := rtu(1, 3, 0, 10, 0, 2)
	transport, decoded, diagnostics := Decode(req, DirectionMasterToSlave)
	if transport != TransportRTU || decoded.Kind != "request" || decoded.UnitID != 1 || *decoded.Address != 10 || *decoded.Quantity != 2 {
		t.Fatalf("unexpected decode: %+v %+v", decoded, diagnostics)
	}
	if decoded.CRCValid == nil || !*decoded.CRCValid || len(diagnostics) != 0 {
		t.Fatalf("valid frame reported invalid: %+v", diagnostics)
	}

	resp := rtu(1, 3, 4, 0x12, 0x34, 0xab, 0xcd)
	_, decoded, diagnostics = Decode(resp, DirectionSlaveToMaster)
	if len(diagnostics) != 0 || len(decoded.Values) != 2 || decoded.Values[0] != 0x1234 || decoded.Values[1] != 0xabcd {
		t.Fatalf("unexpected response: %+v %+v", decoded, diagnostics)
	}
}

func TestDecodeTCPException(t *testing.T) {
	raw := tcpFrame(42, 7, 0x83, 0x02)
	transport, decoded, diagnostics := Decode(raw, DirectionSlaveToMaster)
	if transport != TransportTCP || len(diagnostics) != 0 || decoded.Kind != "exception" || decoded.FunctionCode != 3 || *decoded.ExceptionCode != 2 {
		t.Fatalf("unexpected decode: %+v %+v", decoded, diagnostics)
	}
}

func TestBadCRCIsDiagnostic(t *testing.T) {
	raw := rtu(1, 3, 0, 0, 0, 1)
	raw[len(raw)-1] ^= 0xff
	_, decoded, diagnostics := Decode(raw, DirectionMasterToSlave)
	if decoded == nil || !hasRule(diagnostics, "RTU_BAD_CRC") {
		t.Fatalf("missing bad CRC diagnostic: %+v", diagnostics)
	}
}

func TestEngineCorrelatesAndBoundsFrames(t *testing.T) {
	e := NewEngine(2)
	base := time.Unix(100, 0)
	e.AddRaw("bus-a", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, base)
	response := e.AddRaw("bus-a", DirectionSlaveToMaster, rtu(1, 3, 2, 0, 9), QualityWire, base.Add(3*time.Millisecond))
	if response.ResponseTimeUS != 3000 || response.ConversationID == "" {
		t.Fatalf("pair not correlated: %+v", response)
	}
	e.AddRaw("bus-a", DirectionMasterToSlave, rtu(2, 4, 0, 0, 0, 1), QualityWire, base.Add(4*time.Millisecond))
	snapshot := e.Snapshot(100)
	if len(snapshot.Frames) != 2 || snapshot.Frames[0].Sequence != 2 || snapshot.Health.Requests != 2 || snapshot.Health.Responses != 1 {
		t.Fatalf("unexpected bounded snapshot: %+v", snapshot)
	}
}

func TestEngineUsesMeasuredLatencyAndMarksTimeout(t *testing.T) {
	e := NewEngine(10)
	request := rtu(1, 3, 0, 0, 0, 1)
	response := rtu(1, 3, 2, 0, 9)
	if err := e.AddHexPair("bus-a", spacedHex(hexString(request)), spacedHex(hexString(response)), QualityReconstructed, 27*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	snapshot := e.Snapshot(10)
	if got := snapshot.Frames[1].ResponseTimeUS; got != 27000 {
		t.Fatalf("latency = %d, want 27000", got)
	}

	frame := e.AddRaw("bus-a", DirectionMasterToSlave, request, QualityWire, time.Now())
	e.MarkTimedOut(frame.Sequence)
	snapshot = e.Snapshot(10)
	if snapshot.Health.Timeouts != 1 || snapshot.Health.PendingRequests != 0 || !hasRule(snapshot.Frames[len(snapshot.Frames)-1].Diagnostics, "MODBUS_NO_RESPONSE") {
		t.Fatalf("timeout not recorded: %+v", snapshot.Health)
	}
}

func hexString(raw []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(raw)*2)
	for i, b := range raw {
		out[i*2], out[i*2+1] = digits[b>>4], digits[b&0xf]
	}
	return string(out)
}

func TestDecodeNeverPanicsOnShortFrames(t *testing.T) {
	for n := 0; n < 12; n++ {
		raw := make([]byte, n)
		Decode(raw, DirectionUnknown)
	}
}

func TestDecodeFC07ReadExceptionStatus(t *testing.T) {
	req := rtu(1, 7)
	_, decReq, diagReq := Decode(req, DirectionMasterToSlave)
	if len(diagReq) != 0 || decReq.Kind != "request" || decReq.FunctionCode != 7 {
		t.Fatalf("unexpected FC07 request: %+v %+v", decReq, diagReq)
	}

	resp := rtu(1, 7, 0x45) // bits: 1, 0, 1, 0, 0, 0, 1, 0
	_, decResp, diagResp := Decode(resp, DirectionSlaveToMaster)
	if len(diagResp) != 0 || decResp.Kind != "response" || len(decResp.Values) != 1 || decResp.Values[0] != 0x45 {
		t.Fatalf("unexpected FC07 response: %+v %+v", decResp, diagResp)
	}
	if len(decResp.Bits) != 8 || !decResp.Bits[0] || decResp.Bits[1] || !decResp.Bits[2] {
		t.Fatalf("unexpected FC07 decoded bits: %+v", decResp.Bits)
	}
}

func TestDecodeFC08DiagnosticsEcho(t *testing.T) {
	frame := rtu(2, 8, 0x00, 0x00, 0x12, 0x34)
	_, dec, diags := Decode(frame, DirectionMasterToSlave)
	if len(diags) != 0 || dec.FunctionCode != 8 || dec.SubFunction == nil || *dec.SubFunction != 0 {
		t.Fatalf("unexpected FC08: %+v %+v", dec, diags)
	}
	if len(dec.Values) != 1 || dec.Values[0] != 0x1234 {
		t.Fatalf("unexpected FC08 values: %+v", dec.Values)
	}
}

func TestDecodeFC17ReportServerID(t *testing.T) {
	req := rtu(3, 17)
	_, decReq, _ := Decode(req, DirectionMasterToSlave)
	if decReq.Kind != "request" || decReq.FunctionCode != 17 {
		t.Fatalf("unexpected FC17 req: %+v", decReq)
	}

	resp := rtu(3, 17, 4, 'P', 'L', 'C', '1')
	_, decResp, diags := Decode(resp, DirectionSlaveToMaster)
	if len(diags) != 0 || decResp.Kind != "response" || decResp.FunctionCode != 17 {
		t.Fatalf("unexpected FC17 resp: %+v %+v", decResp, diags)
	}
	if decResp.TextData == "" {
		t.Fatalf("expected non-empty TextData for FC17: %+v", decResp)
	}
}

func TestDecodeFC22MaskWriteRegister(t *testing.T) {
	frame := rtu(1, 22, 0x00, 0x04, 0x00, 0xF2, 0x00, 0x25)
	_, dec, diags := Decode(frame, DirectionMasterToSlave)
	if len(diags) != 0 || dec.FunctionCode != 22 || *dec.Address != 4 {
		t.Fatalf("unexpected FC22: %+v %+v", dec, diags)
	}
	if dec.AndMask == nil || *dec.AndMask != 0x00F2 || dec.OrMask == nil || *dec.OrMask != 0x0025 {
		t.Fatalf("unexpected masks: %+v", dec)
	}
}

func TestDecodeFC23ReadWriteMultipleRegisters(t *testing.T) {
	// Read @3 qty 6, Write @14 qty 2, byte count 4, vals: 0x0102, 0x0304
	req := rtu(1, 23, 0x00, 0x03, 0x00, 0x06, 0x00, 0x0E, 0x00, 0x02, 0x04, 0x01, 0x02, 0x03, 0x04)
	_, decReq, diagsReq := Decode(req, DirectionMasterToSlave)
	if len(diagsReq) != 0 || decReq.Kind != "request" || *decReq.Address != 3 || *decReq.Quantity != 6 {
		t.Fatalf("unexpected FC23 req: %+v %+v", decReq, diagsReq)
	}
	if *decReq.WriteAddress != 14 || *decReq.WriteQuantity != 2 || len(decReq.WriteValues) != 2 {
		t.Fatalf("unexpected FC23 write params: %+v", decReq)
	}

	resp := rtu(1, 23, 4, 0xAA, 0xBB, 0xCC, 0xDD)
	_, decResp, diagsResp := Decode(resp, DirectionSlaveToMaster)
	if len(diagsResp) != 0 || decResp.Kind != "response" || len(decResp.Values) != 2 || decResp.Values[0] != 0xAABB {
		t.Fatalf("unexpected FC23 resp: %+v %+v", decResp, diagsResp)
	}
}

func TestDecodeFC43ReadDeviceIdentification(t *testing.T) {
	req := rtu(1, 43, 0x0E, 0x01, 0x00)
	_, decReq, diagsReq := Decode(req, DirectionMasterToSlave)
	if len(diagsReq) != 0 || decReq.Kind != "request" || decReq.FunctionCode != 43 {
		t.Fatalf("unexpected FC43 req: %+v %+v", decReq, diagsReq)
	}

	// MEI 0x0E, code 0x01, conformity 0x01, more 0x00, next 0x00, num 1, obj 0x00, len 5, "AMITE"
	resp := rtu(1, 43, 0x0E, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 5, 'A', 'M', 'I', 'T', 'E')
	_, decResp, diagsResp := Decode(resp, DirectionSlaveToMaster)
	if len(diagsResp) != 0 || decResp.Kind != "response" || decResp.FunctionCode != 43 {
		t.Fatalf("unexpected FC43 resp: %+v %+v", decResp, diagsResp)
	}
	if decResp.TextData == "" {
		t.Fatalf("expected non-empty TextData: %+v", decResp)
	}
}

func TestEngineBaselineLearnAndMonitor(t *testing.T) {
	e := NewEngine(50)
	if e.GetBaseline().Mode != BaselineModeLearn {
		t.Fatalf("expected initial mode BaselineModeLearn")
	}

	t0 := time.Unix(1000, 0)
	// Simulate 4 periodic request-response cycles on Unit 1 at 100ms interval, 20ms response time
	for i := 0; i < 4; i++ {
		reqTime := t0.Add(time.Duration(i*100) * time.Millisecond)
		respTime := reqTime.Add(20 * time.Millisecond)
		e.AddRaw("bus-1", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, reqTime)
		e.AddRaw("bus-1", DirectionSlaveToMaster, rtu(1, 3, 2, 0, 1), QualityWire, respTime)
	}

	snap := e.Snapshot(0)
	dev1 := snap.Baseline.Devices[1]
	if dev1 == nil {
		t.Fatalf("baseline for unit 1 not found")
	}
	if dev1.MedianPollIntervalMS < 90 || dev1.MedianPollIntervalMS > 110 {
		t.Fatalf("median poll interval = %f, want ~100", dev1.MedianPollIntervalMS)
	}
	if dev1.P95LatencyUS != 20000 {
		t.Fatalf("P95 latency = %d, want 20000", dev1.P95LatencyUS)
	}
	if len(dev1.ObservedFunctionCodes) != 1 || dev1.ObservedFunctionCodes[0] != 3 {
		t.Fatalf("observed FCs = %+v, want [3]", dev1.ObservedFunctionCodes)
	}

	// Switch to Monitor mode
	e.SetBaselineMode(BaselineModeMonitor)
	if e.GetBaseline().Mode != BaselineModeMonitor {
		t.Fatalf("mode not set to monitor")
	}

	// 1. Unexpected Function Code FC 16 on Unit 1
	f1 := e.AddRaw("bus-1", DirectionMasterToSlave, rtu(1, 16, 0, 0, 0, 1, 2, 0, 5), QualityWire, t0.Add(400*time.Millisecond))
	if !hasRule(f1.Diagnostics, "BASELINE_UNEXPECTED_FC") {
		t.Fatalf("expected BASELINE_UNEXPECTED_FC diagnostic on f1: %+v", f1.Diagnostics)
	}

	// 2. Unseen new device Unit 2
	f2 := e.AddRaw("bus-1", DirectionMasterToSlave, rtu(2, 3, 0, 0, 0, 1), QualityWire, t0.Add(500*time.Millisecond))
	if !hasRule(f2.Diagnostics, "BASELINE_NEW_DEVICE") {
		t.Fatalf("expected BASELINE_NEW_DEVICE diagnostic on f2: %+v", f2.Diagnostics)
	}

	// 3. Poll period drift on Unit 1 (300ms gap instead of 100ms)
	f3 := e.AddRaw("bus-1", DirectionMasterToSlave, rtu(1, 3, 0, 0, 0, 1), QualityWire, t0.Add(700*time.Millisecond))
	if !hasRule(f3.Diagnostics, "RTU_POLL_PERIOD_DRIFT") {
		t.Fatalf("expected RTU_POLL_PERIOD_DRIFT diagnostic on f3: %+v", f3.Diagnostics)
	}

	// 4. Slow response exceeding 2x baseline P95 (50ms latency vs 20ms baseline)
	f4 := e.AddRaw("bus-1", DirectionSlaveToMaster, rtu(1, 3, 2, 0, 1), QualityWire, t0.Add(750*time.Millisecond))
	if !hasRule(f4.Diagnostics, "MODBUS_SLOW_RESPONSE") {
		t.Fatalf("expected MODBUS_SLOW_RESPONSE on f4: %+v", f4.Diagnostics)
	}

	// 5. Test ResetBaseline
	resetBase := e.ResetBaseline()
	if len(resetBase.Devices) != 0 || resetBase.SampleFrames != 0 {
		t.Fatalf("reset baseline failed: %+v", resetBase)
	}
}


