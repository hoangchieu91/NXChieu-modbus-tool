package sniffer

import (
	"encoding/binary"
	"fmt"
	"net"
	"time"
)

// Link-layer types returned by pcap_datalink.
const (
	linkTypeNull     = 0   // BSD loopback (Npcap Loopback Adapter): 4-byte family, host order
	linkTypeEthernet = 1   // Ethernet II
	linkTypeRaw      = 12  // raw IP (some platforms)
	linkTypeRawIP    = 101 // raw IP
)

// tcpSegment is the part of a captured packet the Modbus analyzer needs.
type tcpSegment struct {
	src, dst         net.IP
	srcPort, dstPort uint16
	seq              uint32
	syn, fin, rst    bool
	payload          []byte
}

// parsePacket extracts a TCP segment from a link-layer packet. ok is false for anything that is
// not a complete, unfragmented TCP segment over IPv4/IPv6 (ARP, UDP, IP fragments...).
func parsePacket(linkType int, packet []byte) (seg tcpSegment, ok bool) {
	var ip []byte
	switch linkType {
	case linkTypeEthernet:
		if len(packet) < 14 {
			return seg, false
		}
		etherType := binary.BigEndian.Uint16(packet[12:14])
		offset := 14
		for etherType == 0x8100 || etherType == 0x88A8 { // VLAN / QinQ tags
			if len(packet) < offset+4 {
				return seg, false
			}
			etherType = binary.BigEndian.Uint16(packet[offset+2 : offset+4])
			offset += 4
		}
		if etherType != 0x0800 && etherType != 0x86DD {
			return seg, false
		}
		ip = packet[offset:]
	case linkTypeNull:
		if len(packet) < 4 {
			return seg, false
		}
		ip = packet[4:]
	case linkTypeRaw, linkTypeRawIP:
		ip = packet
	default:
		return seg, false
	}
	if len(ip) < 1 {
		return seg, false
	}

	var tcp []byte
	switch ip[0] >> 4 {
	case 4:
		if len(ip) < 20 {
			return seg, false
		}
		ihl := int(ip[0]&0x0F) * 4
		total := int(binary.BigEndian.Uint16(ip[2:4]))
		if ihl < 20 || total < ihl || len(ip) < ihl {
			return seg, false
		}
		if total > len(ip) {
			total = len(ip) // truncated capture: keep what was captured
		}
		fragment := binary.BigEndian.Uint16(ip[6:8])
		if ip[9] != 6 || fragment&0x3FFF != 0 { // not TCP, or a fragment (MF set / offset != 0)
			return seg, false
		}
		seg.src, seg.dst = net.IP(append([]byte(nil), ip[12:16]...)), net.IP(append([]byte(nil), ip[16:20]...))
		tcp = ip[ihl:total] // excludes Ethernet padding after the IP packet
	case 6:
		if len(ip) < 40 || ip[6] != 6 { // only TCP directly after the fixed header
			return seg, false
		}
		end := 40 + int(binary.BigEndian.Uint16(ip[4:6]))
		if end > len(ip) {
			end = len(ip)
		}
		seg.src, seg.dst = net.IP(append([]byte(nil), ip[8:24]...)), net.IP(append([]byte(nil), ip[24:40]...))
		tcp = ip[40:end]
	default:
		return seg, false
	}

	if len(tcp) < 20 {
		return seg, false
	}
	dataOffset := int(tcp[12]>>4) * 4
	if dataOffset < 20 || dataOffset > len(tcp) {
		return seg, false
	}
	flags := tcp[13]
	seg.srcPort = binary.BigEndian.Uint16(tcp[0:2])
	seg.dstPort = binary.BigEndian.Uint16(tcp[2:4])
	seg.seq = binary.BigEndian.Uint32(tcp[4:8])
	seg.fin, seg.syn, seg.rst = flags&0x01 != 0, flags&0x02 != 0, flags&0x04 != 0
	seg.payload = append([]byte(nil), tcp[dataOffset:]...)
	return seg, true
}

// TCPStreamStats counts what the passive reassembler saw on the wire.
type TCPStreamStats struct {
	Packets         uint64 `json:"packets"`
	Retransmissions uint64 `json:"retransmissions"`
	OutOfOrder      uint64 `json:"out_of_order"`
	Gaps            uint64 `json:"gaps"` // missing bytes the capture never saw; the stream resyncs
	Resets          uint64 `json:"resets"`
	Flows           int    `json:"flows"`
}

const (
	maxTCPFlows           = 1024
	maxOutOfOrderSegments = 64
	maxOutOfOrderBytes    = 256 << 10
	tcpFlowIdleTimeout    = 5 * time.Minute
)

// seqBefore reports a < b in TCP sequence space (handles wraparound).
func seqBefore(a, b uint32) bool { return int32(a-b) < 0 }

type tcpHalfStream struct {
	started      bool
	nextSeq      uint32
	pending      map[uint32][]byte
	pendingBytes int
	framer       *StreamFramer
	lastSeen     time.Time
}

// tcpReassembler turns captured TCP segments of Modbus TCP connections into ordered byte
// streams per direction and frames them into Modbus ADUs.
type tcpReassembler struct {
	serverPort uint16
	streams    map[string]*tcpHalfStream // key: "src>dst"
	stats      TCPStreamStats
}

func newTCPReassembler(serverPort uint16) *tcpReassembler {
	if serverPort == 0 {
		serverPort = 502
	}
	return &tcpReassembler{serverPort: serverPort, streams: make(map[string]*tcpHalfStream)}
}

// reassembledFrame is one Modbus ADU recovered from a TCP stream.
type reassembledFrame struct {
	source    string // "pcap:<client ip:port>", identical for both directions of a connection
	direction Direction
	raw       []byte
}

func endpoint(ip net.IP, port uint16) string { return net.JoinHostPort(ip.String(), fmt.Sprint(port)) }

// add processes one segment and returns the Modbus frames it completed.
func (r *tcpReassembler) add(seg tcpSegment, now time.Time) []reassembledFrame {
	r.stats.Packets++
	var direction Direction
	var client string
	switch {
	case seg.dstPort == r.serverPort:
		direction, client = DirectionMasterToSlave, endpoint(seg.src, seg.srcPort)
	case seg.srcPort == r.serverPort:
		direction, client = DirectionSlaveToMaster, endpoint(seg.dst, seg.dstPort)
	default:
		return nil // not Modbus traffic for the configured port
	}
	key := endpoint(seg.src, seg.srcPort) + ">" + endpoint(seg.dst, seg.dstPort)

	if seg.rst {
		r.stats.Resets++
		r.dropConnection(seg)
		return nil
	}
	stream := r.streams[key]
	if stream == nil {
		if len(r.streams) >= maxTCPFlows {
			r.evictIdle(now, true)
		}
		stream = &tcpHalfStream{pending: make(map[uint32][]byte), framer: NewStreamFramer(TransportTCP)}
		r.streams[key] = stream
	}
	stream.lastSeen = now

	seq := seg.seq
	if seg.syn {
		stream.started, stream.nextSeq = true, seq+1
		seq++
		stream.pending, stream.pendingBytes = make(map[uint32][]byte), 0
		stream.framer = NewStreamFramer(TransportTCP)
	}
	var frames []reassembledFrame
	emit := func(data []byte) {
		for _, adu := range stream.framer.Feed(data) {
			frames = append(frames, reassembledFrame{source: "pcap:" + client, direction: direction, raw: adu})
		}
	}

	if len(seg.payload) > 0 {
		if !stream.started { // capture began mid-connection: start at the first data seen
			stream.started, stream.nextSeq = true, seq
		}
		payload := seg.payload
		switch {
		case seq == stream.nextSeq:
			emit(payload)
			stream.nextSeq += uint32(len(payload))
			r.drainPending(stream, emit)
		case seqBefore(seq, stream.nextSeq):
			// Retransmission. Only bytes beyond what was already delivered are new.
			r.stats.Retransmissions++
			end := seq + uint32(len(payload))
			if seqBefore(stream.nextSeq, end) {
				emit(payload[stream.nextSeq-seq:])
				stream.nextSeq = end
				r.drainPending(stream, emit)
			}
		default:
			// A later segment arrived first: hold it (bounded) until the gap is filled.
			r.stats.OutOfOrder++
			if _, dup := stream.pending[seq]; !dup {
				stream.pending[seq] = payload
				stream.pendingBytes += len(payload)
			}
			if len(stream.pending) > maxOutOfOrderSegments || stream.pendingBytes > maxOutOfOrderBytes {
				// The missing bytes were never captured: skip them and resync on the next ADU.
				r.stats.Gaps++
				stream.framer = NewStreamFramer(TransportTCP)
				stream.nextSeq = lowestSeq(stream.pending)
				r.drainPending(stream, emit)
			}
		}
	}
	if seg.fin {
		delete(r.streams, key)
	}
	r.stats.Flows = len(r.streams)
	return frames
}

func (r *tcpReassembler) drainPending(stream *tcpHalfStream, emit func([]byte)) {
	for {
		data, ok := stream.pending[stream.nextSeq]
		if !ok {
			// Also release segments that start inside already-delivered data.
			found := false
			for seq, d := range stream.pending {
				end := seq + uint32(len(d))
				if seqBefore(seq, stream.nextSeq) {
					delete(stream.pending, seq)
					stream.pendingBytes -= len(d)
					if seqBefore(stream.nextSeq, end) {
						emit(d[stream.nextSeq-seq:])
						stream.nextSeq = end
						found = true
						break
					}
				}
			}
			if !found {
				return
			}
			continue
		}
		delete(stream.pending, stream.nextSeq)
		stream.pendingBytes -= len(data)
		emit(data)
		stream.nextSeq += uint32(len(data))
	}
}

func lowestSeq(pending map[uint32][]byte) uint32 {
	first := true
	var low uint32
	for seq := range pending {
		if first || seqBefore(seq, low) {
			low, first = seq, false
		}
	}
	return low
}

// dropConnection forgets both directions of a connection (RST).
func (r *tcpReassembler) dropConnection(seg tcpSegment) {
	a, b := endpoint(seg.src, seg.srcPort), endpoint(seg.dst, seg.dstPort)
	delete(r.streams, a+">"+b)
	delete(r.streams, b+">"+a)
	r.stats.Flows = len(r.streams)
}

// evictIdle drops idle flows; with force it also drops the least recently seen one.
func (r *tcpReassembler) evictIdle(now time.Time, force bool) {
	var oldestKey string
	var oldest time.Time
	for key, s := range r.streams {
		if now.Sub(s.lastSeen) > tcpFlowIdleTimeout {
			delete(r.streams, key)
			continue
		}
		if oldestKey == "" || s.lastSeen.Before(oldest) {
			oldestKey, oldest = key, s.lastSeen
		}
	}
	if force && len(r.streams) >= maxTCPFlows && oldestKey != "" {
		delete(r.streams, oldestKey)
	}
}
