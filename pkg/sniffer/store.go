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

const CaptureSchemaVersion = 2

func SaveCapture(path string, snapshot Snapshot) error {
	return SaveCaptureWithMetadata(path, snapshot, nil)
}

// SaveCaptureWithMetadata persists frames together with the baseline and active register profile.
func SaveCaptureWithMetadata(path string, snapshot Snapshot, profile *ProfileCatalog) error {
	if path == "" {
		return fmt.Errorf("capture path is empty")
	}
	baseline := snapshot.Baseline
	doc := CaptureFile{
		SchemaVersion: CaptureSchemaVersion,
		CreatedAt:     time.Now().Format(time.RFC3339Nano),
		App:           "NXChieu Modbus Tool",
		Frames:        snapshot.Frames,
		Baseline:      &baseline,
		Profile:       profile,
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("encode capture: %w", err)
	}
	return writeAtomic(path, data)
}

func LoadCapture(path string) ([]CapturedFrame, error) {
	doc, err := LoadCaptureDocument(path)
	if err != nil {
		return nil, err
	}
	return doc.Frames, nil
}

// LoadCaptureDocument loads a whole capture into memory. Prefer LoadCaptureInto for opening a
// capture in the analyzer: it streams frames instead of holding them all.
func LoadCaptureDocument(path string) (CaptureFile, error) {
	var frames []CapturedFrame
	meta, err := streamCaptureFile(path, func(_ int, frame CapturedFrame) error {
		frames = append(frames, frame)
		return nil
	})
	if err != nil {
		return CaptureFile{}, err
	}
	if err := validateCaptureMetadata(meta); err != nil {
		return CaptureFile{}, err
	}
	return CaptureFile{
		SchemaVersion: meta.SchemaVersion, CreatedAt: meta.CreatedAt, App: meta.App,
		Frames: frames, Baseline: meta.Baseline, Profile: meta.Profile,
	}, nil
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
	if err := replaceFile(tempName, path); err != nil {
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
	if err := replaceFile(tempName, path); err != nil {
		return fmt.Errorf("finish capture: %w", err)
	}
	return nil
}

// replaceFile preserves the existing destination until the new file can be moved into place.
// This is needed on Windows, where os.Rename cannot replace an existing file directly.
func replaceFile(tempName, path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return os.Rename(tempName, path)
	} else if err != nil {
		return err
	}
	backup, err := os.CreateTemp(filepath.Dir(path), ".nxchieu-backup-*.tmp")
	if err != nil {
		return err
	}
	backupName := backup.Name()
	if err := backup.Close(); err != nil {
		_ = os.Remove(backupName)
		return err
	}
	if err := os.Remove(backupName); err != nil {
		return err
	}
	if err := os.Rename(path, backupName); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		_ = os.Rename(backupName, path)
		return err
	}
	_ = os.Remove(backupName)
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
