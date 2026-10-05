package sniffer

import (
	"encoding/binary"
	"encoding/json"
	"testing"
)

// Fuzz targets required by docs/SNIFFER_AND_BUS_HEALTH_PLAN.md §17.2: every parser must accept
// hostile input without panicking or allocating without bound. Run a target with e.g.
//   go test ./pkg/sniffer -run '^$' -fuzz FuzzDecode -fuzztime 60s

func rtuSeed(b ...byte) []byte {
	return binary.LittleEndian.AppendUint16(append([]byte(nil), b...), crc16(b))
}

func tcpSeed(unit byte, pdu ...byte) []byte {
	out := []byte{0x00, 0x01, 0x00, 0x00, 0x00, byte(1 + len(pdu)), unit}
	return append(out, pdu...)
}

func addDecoderSeeds(f *testing.F) {
	seeds := [][]byte{
		rtuSeed(1, 0x03, 0x00, 0x00, 0x00, 0x02),
		rtuSeed(1, 0x03, 0x04, 0x08, 0x9D, 0x02, 0x00),
		rtuSeed(1, 0x0F, 0x00, 0x13, 0x00, 0x0A, 0x02, 0xCD, 0x01),
		rtuSeed(1, 0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x00, 0x0A, 0x01, 0x02),
		rtuSeed(1, 0x17, 0x00, 0x03, 0x00, 0x06, 0x00, 0x0E, 0x00, 0x03, 0x06, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF),
		rtuSeed(1, 0x2B, 0x0E, 0x01, 0x00),
		rtuSeed(1, 0x2B, 0x0E, 0x01, 0x01, 0x00, 0x00, 0x03, 0x00, 0x03, 'A', 'B', 'C'),
		rtuSeed(1, 0x08, 0x00, 0x00, 0xA5, 0x37),
		rtuSeed(1, 0x83, 0x02),
		rtuSeed(1, 0x16, 0x00, 0x04, 0x00, 0xF2, 0x00, 0x25),
		rtuSeed(1, 0x11),
		rtuSeed(1, 0x11, 0x03, 0x01, 0xFF, 0x41),
		tcpSeed(1, 0x03, 0x00, 0x00, 0x00, 0x0A),
		tcpSeed(1, 0x03, 0xFF),                           // byte count larger than the data
		{0x00, 0x01, 0x00, 0x00, 0xFF, 0xFF, 0x01, 0x03}, // MBAP length far beyond the frame
		{},
		{0x01},
		{0x01, 0x03},
	}
	for _, s := range seeds {
		f.Add(s)
	}
}

func FuzzDecode(f *testing.F) {
	addDecoderSeeds(f)
	f.Fuzz(func(t *testing.T, raw []byte) {
		for _, tr := range []Transport{TransportRTU, TransportTCP} {
			for _, dir := range []Direction{DirectionMasterToSlave, DirectionSlaveToMaster, DirectionUnknown} {
				_, decoded, _ := DecodeTransport(raw, tr, dir)
				if decoded != nil {
					// The UI receives decoded frames as JSON; NaN/Inf or invalid data must not
					// make the marshal fail.
					if _, err := json.Marshal(decoded); err != nil {
						t.Fatalf("decoded frame cannot be sent to the UI: %v", err)
					}
				}
			}
		}
		Decode(raw, DirectionUnknown)
	})
}

func FuzzStreamFramer(f *testing.F) {
	addDecoderSeeds(f)
	f.Fuzz(func(t *testing.T, stream []byte) {
		for _, tr := range []Transport{TransportRTU, TransportTCP} {
			fr := NewStreamFramer(tr)
			total := 0
			// Feed in uneven chunks, as serial ports and sockets deliver data.
			for i := 0; i < len(stream); {
				n := 1 + int(stream[i])%7
				if i+n > len(stream) {
					n = len(stream) - i
				}
				for _, frame := range fr.Feed(stream[i : i+n]) {
					total += len(frame)
				}
				i += n
			}
			for _, frame := range fr.FlushGap() {
				total += len(frame)
			}
			// Frames are carved out of the input: they can never contain more bytes than fed.
			if total > len(stream) {
				t.Fatalf("%s framer emitted %d bytes from %d input bytes", tr, total, len(stream))
			}
		}
	})
}

func FuzzLoadProfileCatalog(f *testing.F) {
	// Seeds must pass validation (unit_id matching the map key, data_type), otherwise the fuzzer
	// only ever exercises the rejection path.
	f.Add([]byte(`{"devices":{"1":{"unit_id":1,"device_name":"PM","registers":[{"address":0,"name":"V","data_type":"float32_abcd","scale":1,"unit":"V"},{"address":2,"name":"I","data_type":"float32_cdba","scale":1000,"unit":"A"}]}}}`))
	f.Add([]byte(`{"devices":{"2":{"unit_id":2,"registers":[{"address":65535,"name":"E","data_type":"uint32","scale":0.1},{"address":1,"name":"T","data_type":"int16","scale":1e308}]}}}`))
	f.Add([]byte(`{}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		catalog, err := LoadProfileCatalog(data)
		if err != nil || catalog == nil {
			return
		}
		// 0xFFFF 0xFFFF is a NaN float32, a common "sensor fault" value.
		values := []uint16{0xFFFF, 0xFFFF, 0x4148, 0x0000, 0x7F80, 0x0000, 0x8000}
		for unit := 0; unit < 4; unit++ {
			for _, start := range []uint16{0, 1, 65533, 65535} {
				evs := catalog.DecodeEngineeringValues(uint8(unit), start, values)
				if _, err := json.Marshal(evs); err != nil {
					t.Fatalf("engineering values cannot be sent to the UI: %v", err)
				}
			}
		}
	})
}
