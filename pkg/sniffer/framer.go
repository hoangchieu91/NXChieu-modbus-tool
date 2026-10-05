package sniffer

import "encoding/binary"

// StreamFramer turns arbitrary TCP/serial read chunks into complete Modbus ADUs.
type StreamFramer struct {
	transport Transport
	buffer    []byte
	dropped   uint64
}

func NewStreamFramer(transport Transport) *StreamFramer {
	return &StreamFramer{transport: transport, buffer: make([]byte, 0, 512)}
}

func (f *StreamFramer) Dropped() uint64 { return f.dropped }

func (f *StreamFramer) Feed(chunk []byte) [][]byte {
	if len(chunk) > 0 {
		f.buffer = append(f.buffer, chunk...)
	}
	if f.transport == TransportTCP {
		return f.takeTCP()
	}
	return f.takeRTU(false)
}

// FlushGap is called after an RTU silent interval. It emits valid frames and drops remaining
// noise so bytes from separate RTU frames are never joined accidentally.
func (f *StreamFramer) FlushGap() [][]byte {
	if f.transport == TransportTCP {
		return nil
	}
	frames := f.takeRTU(true)
	if len(f.buffer) > 0 {
		f.dropped += uint64(len(f.buffer))
		f.buffer = f.buffer[:0]
	}
	return frames
}

func (f *StreamFramer) takeTCP() (frames [][]byte) {
	for len(f.buffer) >= 7 {
		length := int(binary.BigEndian.Uint16(f.buffer[4:6]))
		if length < 2 || length > 254 || binary.BigEndian.Uint16(f.buffer[2:4]) != 0 {
			f.buffer = f.buffer[1:]
			f.dropped++
			continue
		}
		total := 6 + length
		if len(f.buffer) < total {
			break
		}
		frames = append(frames, append([]byte(nil), f.buffer[:total]...))
		f.buffer = f.buffer[total:]
	}
	return frames
}

func (f *StreamFramer) takeRTU(flush bool) (frames [][]byte) {
	// A brute-force CRC search over every length is only done at a silent gap and only for the
	// frame starting at the first byte; repeating it for each byte of continuous noise made a
	// noisy bus take longer to frame than real time.
	bruteForce := flush
	for len(f.buffer) >= 4 {
		lengths := rtuCandidateLengths(f.buffer, bruteForce)
		bruteForce = false
		matched := 0
		for _, length := range lengths {
			if length <= len(f.buffer) && length >= 4 && crc16(f.buffer[:length-2]) == binary.LittleEndian.Uint16(f.buffer[length-2:length]) {
				matched = length
				break
			}
		}
		if matched > 0 {
			frames = append(frames, append([]byte(nil), f.buffer[:matched]...))
			f.buffer = f.buffer[matched:]
			continue
		}
		if !flush && len(f.buffer) < 260 {
			break
		}
		f.buffer = f.buffer[1:]
		f.dropped++
	}
	return frames
}

func rtuCandidateLengths(buffer []byte, bruteForce bool) []int {
	if len(buffer) < 2 {
		return nil
	}
	fc := buffer[1]
	if fc&0x80 != 0 {
		return []int{5}
	}
	switch fc {
	case 1, 2, 3, 4:
		lengths := []int{8}
		if len(buffer) >= 3 {
			lengths = append(lengths, 5+int(buffer[2]))
		}
		return uniqueLengths(lengths)
	case 5, 6:
		return []int{8}
	case 15, 16:
		lengths := []int{8}
		if len(buffer) >= 7 {
			lengths = append(lengths, 9+int(buffer[6]))
		}
		return uniqueLengths(lengths)
	case 7, 17: // request: unit+fc+crc; FC07 response 5 bytes; FC17 response with byte count
		lengths := []int{4, 5}
		if fc == 17 && len(buffer) >= 3 {
			lengths = append(lengths, 5+int(buffer[2]))
		}
		return uniqueLengths(lengths)
	case 8:
		// Most sub-functions carry one data word; others are found by CRC search at a gap.
		if bruteForce {
			return append([]int{8}, bruteForceLengths(buffer)...)
		}
		return []int{8}
	case 22:
		return []int{10}
	case 23:
		lengths := []int{}
		if len(buffer) >= 11 {
			lengths = append(lengths, 13+int(buffer[10])) // request with write byte count
		}
		if len(buffer) >= 3 {
			lengths = append(lengths, 5+int(buffer[2])) // response with read byte count
		}
		return uniqueLengths(lengths)
	default:
		if !bruteForce {
			return nil
		}
		// Unknown functions (e.g. FC43) are still recoverable at an RTU silent gap by CRC search.
		return bruteForceLengths(buffer)
	}
}

// bruteForceLengths lists every possible RTU frame length (4..256) for a CRC search.
func bruteForceLengths(buffer []byte) []int {
	lengths := make([]int, 0, minInt(len(buffer)-3, 253))
	for n := 4; n <= len(buffer) && n <= 256; n++ {
		lengths = append(lengths, n)
	}
	return lengths
}

func uniqueLengths(values []int) []int {
	seen := map[int]bool{}
	out := make([]int, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
