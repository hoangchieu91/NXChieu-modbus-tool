package sniffer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestShiftReportGeneration(t *testing.T) {
	snap := Snapshot{
		Frames: []CapturedFrame{
			{
				ID:                "f-1",
				CapturedAtUnixNS:  time.Now().UnixNano(),
				Transport:         TransportRTU,
				Direction:         DirectionMasterToSlave,
				CaptureQuality:    QualityWire,
				Hex:               "010600010064d9e2",
				Parsed: &DecodedModbus{
					UnitID:       1,
					FunctionCode: 6,
					FunctionName: "Write Single Register",
					Address:      uint16Ptr(1),
					Values:       []uint16{100},
				},
				Diagnostics: []DiagnosticItem{
					{
						RuleID:         "MODBUS_WRITE_OBSERVED",
						Severity:       "info",
						Message:        "Phát hiện lệnh ghi Modbus",
						Recommendation: "Đối chiếu nhật ký",
					},
				},
			},
		},
		Health: HealthSnapshot{
			Score:            92,
			State:            "good",
			TotalFrames:      1,
			Requests:         1,
			Responses:        0,
			P95LatencyUS:     5000,
			Devices: []DeviceHealth{
				{
					UnitID:       1,
					State:        "good",
					Requests:     1,
					Responses:    1,
					SuccessRate:  100.0,
					P95LatencyUS: 5000,
				},
			},
		},
	}

	htmlContent := GenerateShiftReportHTML(snap, ShiftReportOptions{
		Title:    "Báo Cáo Thử Nghiệm",
		Operator: "Kỹ sư Chiểu",
		Shift:    "Ca Sáng",
		Notes:    "Kiểm tra định kỳ tủ điện MSB",
	})

	if !strings.Contains(htmlContent, "Báo Cáo Thử Nghiệm") {
		t.Error("Missing title in report HTML")
	}
	if !strings.Contains(htmlContent, "Kỹ sư Chiểu") {
		t.Error("Missing operator in report HTML")
	}
	if !strings.Contains(htmlContent, "Unit 1") {
		t.Error("Missing Unit 1 in device table")
	}
	if !strings.Contains(htmlContent, "Write Single Register") {
		t.Error("Missing Write Single Register in write audit log")
	}
	if !strings.Contains(htmlContent, "MODBUS_WRITE_OBSERVED") {
		t.Error("Missing diagnostic rule in report HTML")
	}

	// Test ExportShiftReport file writing
	dir := t.TempDir()
	outPath := filepath.Join(dir, "report.html")
	if err := ExportShiftReport(outPath, snap, ShiftReportOptions{Title: "Test Export"}); err != nil {
		t.Fatalf("ExportShiftReport failed: %v", err)
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if !strings.Contains(string(data), "Test Export") {
		t.Error("Exported file does not contain expected title")
	}
}

func uint16Ptr(v uint16) *uint16 {
	return &v
}
