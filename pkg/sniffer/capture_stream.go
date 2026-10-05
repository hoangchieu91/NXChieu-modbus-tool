package sniffer

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// maxCaptureFileSize is a sanity limit only: captures are streamed, so memory use follows the
// analyzer ring (50k frames), not the file size.
const maxCaptureFileSize = 4 << 30

// CaptureMetadata is everything in a capture file except its frames.
type CaptureMetadata struct {
	SchemaVersion int
	CreatedAt     string
	App           string
	Baseline      *BaselineProfile
	Profile       *ProfileCatalog
	FrameCount    int
}

// streamCaptureFile decodes a capture file token by token. onFrame (optional) receives each
// frame as it is read, so the frames array is never held in memory as a whole.
func streamCaptureFile(path string, onFrame func(index int, frame CapturedFrame) error) (CaptureMetadata, error) {
	var meta CaptureMetadata
	info, err := os.Stat(path)
	if err != nil {
		return meta, fmt.Errorf("open capture: %w", err)
	}
	if info.Size() > maxCaptureFileSize {
		return meta, fmt.Errorf("capture exceeds %d GB safety limit", maxCaptureFileSize>>30)
	}
	file, err := os.Open(path)
	if err != nil {
		return meta, fmt.Errorf("open capture: %w", err)
	}
	defer file.Close()

	dec := json.NewDecoder(bufio.NewReaderSize(file, 1<<20))
	if err := expectDelim(dec, '{'); err != nil {
		return meta, err
	}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return meta, fmt.Errorf("decode capture: %w", err)
		}
		key, _ := tok.(string)
		switch key {
		case "schema_version":
			err = dec.Decode(&meta.SchemaVersion)
		case "created_at":
			err = dec.Decode(&meta.CreatedAt)
		case "app":
			err = dec.Decode(&meta.App)
		case "baseline":
			err = dec.Decode(&meta.Baseline)
		case "profile":
			err = dec.Decode(&meta.Profile)
		case "frames":
			err = streamFrames(dec, &meta, onFrame)
		default:
			var skip json.RawMessage
			err = dec.Decode(&skip)
		}
		if err != nil {
			return meta, fmt.Errorf("decode capture %q: %w", key, err)
		}
	}
	if err := expectDelim(dec, '}'); err != nil {
		return meta, err
	}
	return meta, nil
}

func streamFrames(dec *json.Decoder, meta *CaptureMetadata, onFrame func(int, CapturedFrame) error) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if tok == nil {
		return nil // "frames": null
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("frames must be an array")
	}
	for dec.More() {
		var frame CapturedFrame
		if err := dec.Decode(&frame); err != nil {
			return err
		}
		if len(frame.Raw) > 260 {
			return fmt.Errorf("frame %d exceeds Modbus ADU limit", meta.FrameCount+1)
		}
		if onFrame != nil {
			if err := onFrame(meta.FrameCount, frame); err != nil {
				return err
			}
		}
		meta.FrameCount++
	}
	_, err = dec.Token() // closing ']'
	return err
}

func expectDelim(dec *json.Decoder, want json.Delim) error {
	tok, err := dec.Token()
	if err == io.EOF {
		return fmt.Errorf("decode capture: unexpected end of file")
	}
	if err != nil {
		return fmt.Errorf("decode capture: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != want {
		return fmt.Errorf("decode capture: expected %q", want)
	}
	return nil
}

func validateCaptureMetadata(meta CaptureMetadata) error {
	if meta.SchemaVersion != 1 && meta.SchemaVersion != CaptureSchemaVersion {
		return fmt.Errorf("unsupported capture schema %d", meta.SchemaVersion)
	}
	if meta.Profile != nil {
		if err := validateProfileCatalog(meta.Profile); err != nil {
			return fmt.Errorf("invalid embedded profile: %w", err)
		}
	}
	return nil
}

// LoadCaptureInto replaces the engine's contents with a capture file. The file is validated in
// a first streaming pass, so a broken file never clears the current analyzer; the second pass
// streams frames straight into the engine.
func LoadCaptureInto(path string, engine *Engine) (CaptureMetadata, error) {
	meta, err := streamCaptureFile(path, nil)
	if err != nil {
		return meta, err
	}
	if err := validateCaptureMetadata(meta); err != nil {
		return meta, err
	}
	err = engine.ReplaceStream(meta.Baseline, meta.Profile, func(add func(CapturedFrame)) error {
		_, err := streamCaptureFile(path, func(_ int, frame CapturedFrame) error {
			add(frame)
			return nil
		})
		return err
	})
	return meta, err
}
