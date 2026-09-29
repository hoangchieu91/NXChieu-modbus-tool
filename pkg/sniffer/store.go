package sniffer

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const CaptureSchemaVersion = 1

func SaveCapture(path string, snapshot Snapshot) error {
	if path == "" {
		return fmt.Errorf("capture path is empty")
	}
	doc := CaptureFile{SchemaVersion: CaptureSchemaVersion, CreatedAt: time.Now().Format(time.RFC3339Nano), App: "NXChieu Modbus Tool", Frames: snapshot.Frames}
	data, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("encode capture: %w", err)
	}
	return writeAtomic(path, data)
}

func LoadCapture(path string) ([]CapturedFrame, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("open capture: %w", err)
	}
	if info.Size() > 512*1024*1024 {
		return nil, fmt.Errorf("capture exceeds 512 MB safety limit")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read capture: %w", err)
	}
	var doc CaptureFile
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("decode capture: %w", err)
	}
	if doc.SchemaVersion != CaptureSchemaVersion {
		return nil, fmt.Errorf("unsupported capture schema %d", doc.SchemaVersion)
	}
	for index := range doc.Frames {
		if len(doc.Frames[index].Raw) > 260 {
			return nil, fmt.Errorf("frame %d exceeds Modbus ADU limit", index+1)
		}
	}
	return doc.Frames, nil
}

func ExportCSV(path string, snapshot Snapshot) error {
	if path == "" {
		return fmt.Errorf("export path is empty")
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".nxchieu-export-*.tmp")
	if err != nil {
		return fmt.Errorf("create export: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	writer := csv.NewWriter(temp)
	_ = writer.Write([]string{"sequence", "timestamp", "source", "transport", "direction", "quality", "unit_id", "function", "kind", "address", "quantity", "latency_us", "diagnostics", "hex"})
	for _, frame := range snapshot.Frames {
		row := []string{strconv.FormatUint(frame.Sequence, 10), time.Unix(0, frame.CapturedAtUnixNS).Format(time.RFC3339Nano), frame.SourceID, string(frame.Transport), string(frame.Direction), string(frame.CaptureQuality), "", "", "", "", "", strconv.FormatUint(frame.ResponseTimeUS, 10), diagnosticIDs(frame.Diagnostics), frame.Hex}
		if frame.Parsed != nil {
			row[6] = strconv.Itoa(int(frame.Parsed.UnitID))
			row[7] = fmt.Sprintf("FC%02d %s", frame.Parsed.FunctionCode, frame.Parsed.FunctionName)
			row[8] = frame.Parsed.Kind
			if frame.Parsed.Address != nil {
				row[9] = strconv.Itoa(int(*frame.Parsed.Address))
			}
			if frame.Parsed.Quantity != nil {
				row[10] = strconv.Itoa(int(*frame.Parsed.Quantity))
			}
		}
		if err := writer.Write(row); err != nil {
			_ = temp.Close()
			return fmt.Errorf("write export: %w", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("flush export: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close export: %w", err)
	}
	_ = os.Remove(path)
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("finish export: %w", err)
	}
	return nil
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".nxchieu-capture-*.tmp")
	if err != nil {
		return fmt.Errorf("create capture: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write capture: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("sync capture: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close capture: %w", err)
	}
	_ = os.Remove(path)
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("finish capture: %w", err)
	}
	return nil
}

func diagnosticIDs(items []DiagnosticItem) string {
	out := ""
	for _, item := range items {
		if out != "" {
			out += ";"
		}
		out += item.RuleID
	}
	return out
}
