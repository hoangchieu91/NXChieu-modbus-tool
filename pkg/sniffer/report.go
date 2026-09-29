package sniffer

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ShiftReportOptions contains metadata for report generation.
type ShiftReportOptions struct {
	Title    string `json:"title"`
	Operator string `json:"operator"`
	Shift    string `json:"shift"`
	Notes    string `json:"notes"`
}

// GenerateShiftReportHTML creates a self-contained, print-ready HTML shift health report.
func GenerateShiftReportHTML(snap Snapshot, opts ShiftReportOptions) string {
	if opts.Title == "" {
		opts.Title = "BÁO CÁO SỨC KHỎE MẠNG TRUYỀN THÔNG MODBUS"
	}
	if opts.Operator == "" {
		opts.Operator = "Vận hành viên"
	}
	if opts.Shift == "" {
		opts.Shift = "Ca trực tiêu chuẩn"
	}

	h := snap.Health
	scoreColor := "#10b981" // green
	scoreText := "TỐT (GOOD)"
	if h.Score < 60 {
		scoreColor = "#ef4444" // red
		scoreText = "NGUY CẤP (CRITICAL)"
	} else if h.Score < 80 {
		scoreColor = "#f59e0b" // yellow
		scoreText = "CẢNH BÁO (WARNING)"
	}

	successRate := 100.0
	if h.Requests > 0 {
		errCount := h.Exceptions + h.Timeouts + h.CRCErrorFrames
		if h.Requests >= errCount {
			successRate = float64(h.Requests-errCount) / float64(h.Requests) * 100.0
		} else {
			successRate = 0.0
		}
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>` + html.EscapeString(opts.Title) + `</title>
<style>
  :root {
    --primary: #2563eb;
    --text: #1e293b;
    --bg: #f8fafc;
    --card: #ffffff;
    --border: #e2e8f0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--text);
    background-color: var(--bg);
    line-height: 1.5;
    padding: 24px;
  }
  .container { max-width: 1000px; margin: 0 auto; background: var(--card); border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 32px; border: 1px solid var(--border); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
  .header-left h1 { font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
  .header-left p { font-size: 14px; color: #64748b; }
  .badge-score { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; width: 100px; height: 100px; border-radius: 50%; color: white; font-weight: bold; background-color: ` + scoreColor + `; box-shadow: 0 4px 10px rgba(0,0,0,0.15); }
  .badge-score .score-num { font-size: 32px; line-height: 1; }
  .badge-score .score-lbl { font-size: 10px; opacity: 0.9; margin-top: 4px; }
  
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; background: #f1f5f9; padding: 16px; border-radius: 8px; font-size: 13px; }
  .meta-item strong { color: #475569; display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
  .kpi-card { background: #ffffff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
  .kpi-val { font-size: 22px; font-weight: 700; color: #0f172a; }
  .kpi-title { font-size: 12px; color: #64748b; margin-top: 4px; }
  
  h2 { font-size: 16px; font-weight: 600; margin: 24px 0 12px; border-left: 4px solid var(--primary); padding-left: 10px; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  th { background: #f8fafc; text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--border); font-weight: 600; color: #475569; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  tr:nth-child(even) { background-color: #fafbfc; }
  
  .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .pill-good { background: #dcfce7; color: #15803d; }
  .pill-warn { background: #fef3c7; color: #b45309; }
  .pill-bad  { background: #fee2e2; color: #b91c1c; }
  .pill-info { background: #e0f2fe; color: #0369a1; }
  
  .print-bar { display: flex; justify-content: flex-end; gap: 12px; margin-bottom: 16px; }
  .btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer; border: none; }
  .btn-primary { background: var(--primary); color: white; }
  .btn-primary:hover { opacity: 0.9; }

  @media print {
    body { background: white; padding: 0; }
    .container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
    .print-bar { display: none; }
    @page { margin: 12mm; size: A4; }
  }
</style>
</head>
<body>

<div class="print-bar">
  <button class="btn btn-primary" onclick="window.print()">🖨️ In Báo Cáo / Lưu PDF</button>
</div>

<div class="container">
  <div class="header">
    <div class="header-left">
      <h1>` + html.EscapeString(opts.Title) + `</h1>
      <p>Hệ thống giám sát phân tích Modbus chuyên dụng — NXChieu Modbus Tool</p>
    </div>
    <div class="badge-score">
      <span class="score-num">` + fmt.Sprintf("%d", h.Score) + `</span>
      <span class="score-lbl">` + scoreText + `</span>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><strong>Thời điểm lập báo cáo</strong>` + time.Now().Format("02/01/2006 15:04:05") + `</div>
    <div class="meta-item"><strong>Vận hành viên</strong>` + html.EscapeString(opts.Operator) + `</div>
    <div class="meta-item"><strong>Ca trực</strong>` + html.EscapeString(opts.Shift) + `</div>
    <div class="meta-item"><strong>Ghi chú / Khu vực</strong>` + html.EscapeString(opts.Notes) + `</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-val">` + fmt.Sprintf("%d", len(snap.Frames)) + `</div>
      <div class="kpi-title">Tổng khung tin đã bắt</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color: ` + scoreColor + `">` + fmt.Sprintf("%.1f%%", successRate) + `</div>
      <div class="kpi-title">Tỷ lệ thành công (Success Rate)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">` + formatLatencyUS(h.P95LatencyUS) + `</div>
      <div class="kpi-title">Độ trễ phản hồi P95</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">` + fmt.Sprintf("%d", h.Timeouts+h.CRCErrorFrames+h.Exceptions) + `</div>
      <div class="kpi-title">Tổng khung tin sự cố (Lỗi/Timeout)</div>
    </div>
  </div>

  <h2>1. Bảng tình trạng sức khỏe thiết bị (Slave Devices Matrix)</h2>
  <table>
    <thead>
      <tr>
        <th>Unit ID</th>
        <th>Trạng thái</th>
        <th>Yêu cầu (Req)</th>
        <th>Phản hồi (Resp)</th>
        <th>Lỗi ngoại lệ</th>
        <th>Timeouts</th>
        <th>Tỷ lệ thành công</th>
        <th>Độ trễ P95</th>
      </tr>
    </thead>
    <tbody>`)

	if len(h.Devices) == 0 {
		sb.WriteString(`<tr><td colspan="8" style="text-align: center; color: #94a3b8;">Chưa ghi nhận thiết bị Modbus Slave nào trên đường truyền</td></tr>`)
	} else {
		for _, dev := range h.Devices {
			statusPill := `<span class="pill pill-good">Hoạt động tốt</span>`
			if dev.State == "critical" || dev.SuccessRate < 80 {
				statusPill = `<span class="pill pill-bad">Nguy cấp</span>`
			} else if dev.State == "warning" || dev.SuccessRate < 95 {
				statusPill = `<span class="pill pill-warn">Cảnh báo</span>`
			}

			sb.WriteString(fmt.Sprintf(`
      <tr>
        <td><strong>Unit %d</strong></td>
        <td>%s</td>
        <td>%d</td>
        <td>%d</td>
        <td>%d</td>
        <td>%d</td>
        <td><strong>%.1f%%</strong></td>
        <td>%s</td>
      </tr>`, dev.UnitID, statusPill, dev.Requests, dev.Responses, dev.Exceptions, dev.Timeouts, dev.SuccessRate, formatLatencyUS(dev.P95LatencyUS)))
		}
	}

	sb.WriteString(`
    </tbody>
  </table>

  <h2>2. Nhật ký kiểm toán thao tác ghi dữ liệu (Modbus Write Audit Log)</h2>
  <table>
    <thead>
      <tr>
        <th>Thời gian</th>
        <th>Unit</th>
        <th>Chức năng</th>
        <th>Địa chỉ ghi</th>
        <th>Giá trị / Số lượng</th>
        <th>Dữ liệu thô</th>
      </tr>
    </thead>
    <tbody>`)

	writeCount := 0
	for _, frame := range snap.Frames {
		if frame.Parsed != nil && (frame.Parsed.FunctionCode == 5 || frame.Parsed.FunctionCode == 6 || frame.Parsed.FunctionCode == 15 || frame.Parsed.FunctionCode == 16 || frame.Parsed.FunctionCode == 22 || frame.Parsed.FunctionCode == 23) {
			writeCount++
			if writeCount > 50 {
				continue // Cap to 50 write records to keep report manageable
			}
			addrStr := "—"
			if frame.Parsed.Address != nil {
				addrStr = fmt.Sprintf("%d (0x%04X)", *frame.Parsed.Address, *frame.Parsed.Address)
			}
			valStr := "—"
			if len(frame.Parsed.Values) > 0 {
				valStr = fmt.Sprintf("%v", frame.Parsed.Values)
			} else if len(frame.Parsed.Bits) > 0 {
				valStr = fmt.Sprintf("%v", frame.Parsed.Bits)
			}

			tStr := time.Unix(0, frame.CapturedAtUnixNS).Format("15:04:05.000")
			sb.WriteString(fmt.Sprintf(`
      <tr>
        <td>%s</td>
        <td>Unit %d</td>
        <td><span class="pill pill-info">FC%02d %s</span></td>
        <td>%s</td>
        <td>%s</td>
        <td><code>%s</code></td>
      </tr>`, tStr, frame.Parsed.UnitID, frame.Parsed.FunctionCode, html.EscapeString(frame.Parsed.FunctionName), addrStr, html.EscapeString(valStr), frame.Hex))
		}
	}

	if writeCount == 0 {
		sb.WriteString(`<tr><td colspan="6" style="text-align: center; color: #94a3b8;">Không có lệnh ghi Modbus (Write Commands) nào trong ca này</td></tr>`)
	}

	sb.WriteString(`
    </tbody>
  </table>

  <h2>3. Khung tin bất thường & Chẩn đoán cảnh báo (Anomalies & Diagnostics)</h2>
  <table>
    <thead>
      <tr>
        <th>Mã quy tắc</th>
        <th>Mức độ</th>
        <th>Nội dung thông báo</th>
        <th>Khuyến nghị kỹ thuật</th>
      </tr>
    </thead>
    <tbody>`)

	diagCount := 0
	diagSeen := make(map[string]bool)
	for _, frame := range snap.Frames {
		for _, d := range frame.Diagnostics {
			key := d.RuleID + ":" + d.Message
			if diagSeen[key] {
				continue
			}
			diagSeen[key] = true
			diagCount++
			if diagCount > 30 {
				break
			}
			pillClass := "pill-info"
			if d.Severity == "critical" || d.Severity == "error" {
				pillClass = "pill-bad"
			} else if d.Severity == "warning" {
				pillClass = "pill-warn"
			}

			sb.WriteString(fmt.Sprintf(`
      <tr>
        <td><code>%s</code></td>
        <td><span class="pill %s">%s</span></td>
        <td>%s</td>
        <td>%s</td>
      </tr>`, html.EscapeString(d.RuleID), pillClass, strings.ToUpper(d.Severity), html.EscapeString(d.Message), html.EscapeString(d.Recommendation)))
		}
	}

	if diagCount == 0 {
		sb.WriteString(`<tr><td colspan="4" style="text-align: center; color: #15803d; font-weight: 500;">✓ Toàn bộ đường truyền Modbus vận hành hoàn hảo, không có cảnh báo nào</td></tr>`)
	}

	sb.WriteString(`
    </tbody>
  </table>

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px dashed var(--border); display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8;">
    <span>NXChieu Modbus Tool & Analyzer</span>
    <span>Trang 1 / 1 — Tài liệu bảo mật nội bộ</span>
  </div>
</div>

</body>
</html>`)

	return sb.String()
}

// ExportShiftReport saves the generated report HTML to a file atomically.
func ExportShiftReport(path string, snap Snapshot, opts ShiftReportOptions) error {
	if path == "" {
		return fmt.Errorf("report export path is empty")
	}
	content := GenerateShiftReportHTML(snap, opts)
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".nxchieu-report-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp report file: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)

	if _, err := temp.WriteString(content); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write report: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close report: %w", err)
	}
	_ = os.Remove(path)
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("rename report file: %w", err)
	}
	return nil
}
