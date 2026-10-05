package sniffer

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

var (
	masterIP = net.IPv4(192, 168, 1, 10).To4()
	slaveIP  = net.IPv4(192, 168, 1, 20).To4()
)

// ethTCP builds an Ethernet II / IPv4 / TCP packet. flags: 0x02 SYN, 0x01 FIN, 0x04 RST.
func ethTCP(src, dst net.IP, sport, dport uint16, seq uint32, flags byte, payload []byte, vlan bool, padTo int) []byte {
	tcp := make([]byte, 20)
	binary.BigEndian.PutUint16(tcp[0:], sport)
	binary.BigEndian.PutUint16(tcp[2:], dport)
	binary.BigEndian.PutUint32(tcp[4:], seq)
	tcp[12] = 5 << 4
	tcp[13] = flags | 0x10
	tcp = append(tcp, payload...)
	ip := make([]byte, 20)
	ip[0] = 0x45
	binary.BigEndian.PutUint16(ip[2:], uint16(20+len(tcp)))
	ip[8], ip[9] = 64, 6
	copy(ip[12:], src)
	copy(ip[16:], dst)
	ip = append(ip, tcp...)
	eth := make([]byte, 12)
	if vlan {
		eth = append(eth, 0x81, 0x00, 0x00, 0x05)
	}
	eth = append(eth, 0x08, 0x00)
	pkt := append(eth, ip...)
	for len(pkt) < padTo { // Ethernet minimum frame padding after the IP packet
		pkt = append(pkt, 0xEE)
	}
	return pkt
}

func feed(t *testing.T, r *tcpReassembler, pkt []byte) []reassembledFrame {
	t.Helper()
	seg, ok := parsePacket(linkTypeEthernet, pkt)
	if !ok {
		t.Fatal("packet not parsed")
	}
	return r.add(seg, time.Now())
}

func TestParsePacketIgnoresPaddingAndVLAN(t *testing.T) {
	req := tcpFrame(1, 1, 3, 0, 0, 0, 2)
	seg, ok := parsePacket(linkTypeEthernet, ethTCP(masterIP, slaveIP, 50000, 502, 100, 0, req, true, 80))
	if !ok || !bytes.Equal(seg.payload, req) || seg.dstPort != 502 {
		t.Fatalf("ok=%v payload=% X", ok, seg.payload)
	}
	// Loopback (DLT_NULL) carries a 4-byte family header instead of Ethernet.
	ipPkt := ethTCP(masterIP, slaveIP, 50000, 502, 100, 0, req, false, 0)[14:]
	seg, ok = parsePacket(linkTypeNull, append([]byte{2, 0, 0, 0}, ipPkt...))
	if !ok || !bytes.Equal(seg.payload, req) {
		t.Fatal("loopback packet not parsed")
	}
	if _, ok := parsePacket(linkTypeEthernet, []byte{1, 2, 3}); ok {
		t.Fatal("garbage parsed as TCP")
	}
}

func TestReassemblerSplitReorderRetransmit(t *testing.T) {
	r := newTCPReassembler(502)
	req := tcpFrame(7, 1, 3, 0, 0, 0, 2)
	resp := tcpFrame(7, 1, 3, 4, 0, 1, 0, 2)

	if got := feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 999, 0x02, nil, false, 0)); len(got) != 0 {
		t.Fatal("SYN produced frames")
	}
	// Request split in two segments that arrive in reverse order.
	if got := feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 1005, 0, req[5:], false, 0)); len(got) != 0 {
		t.Fatal("out-of-order tail emitted early")
	}
	got := feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 1000, 0, req[:5], false, 0))
	if len(got) != 1 || !bytes.Equal(got[0].raw, req) || got[0].direction != DirectionMasterToSlave {
		t.Fatalf("reassembled request wrong: %+v", got)
	}
	// Retransmission of the whole request must not produce a second frame.
	if got := feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 1000, 0, req, false, 0)); len(got) != 0 {
		t.Fatal("retransmission duplicated the request")
	}
	// Response captured mid-connection (no SYN seen for this direction).
	got = feed(t, r, ethTCP(slaveIP, masterIP, 502, 50000, 77, 0, resp, false, 64))
	if len(got) != 1 || got[0].direction != DirectionSlaveToMaster || got[0].source != got[0].source {
		t.Fatalf("response wrong: %+v", got)
	}
	if got[0].source != "pcap:192.168.1.10:50000" {
		t.Fatalf("both directions must share the client source, got %q", got[0].source)
	}
	if r.stats.Retransmissions != 1 || r.stats.OutOfOrder != 1 {
		t.Fatalf("stats: %+v", r.stats)
	}
	// Non-Modbus port and RST handling.
	if got := feed(t, r, ethTCP(masterIP, slaveIP, 50001, 80, 1, 0, []byte("GET /"), false, 0)); len(got) != 0 {
		t.Fatal("non-Modbus traffic produced frames")
	}
	feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 1012, 0x04, nil, false, 0))
	if r.stats.Resets != 1 || r.stats.Flows != 0 {
		t.Fatalf("RST not handled: %+v", r.stats)
	}
}

// A capture that misses bytes must give up on them instead of buffering forever.
func TestReassemblerResyncsAfterUncapturedGap(t *testing.T) {
	r := newTCPReassembler(502)
	req := tcpFrame(1, 1, 3, 0, 0, 0, 1)
	feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, 0, 0x02, nil, false, 0))
	seq := uint32(1 + 1000) // 1000 bytes never captured
	var frames int
	for i := 0; i < maxOutOfOrderSegments+2; i++ {
		frames += len(feed(t, r, ethTCP(masterIP, slaveIP, 50000, 502, seq, 0, req, false, 0)))
		seq += uint32(len(req))
	}
	if r.stats.Gaps == 0 || frames == 0 {
		t.Fatalf("no resync after gap: frames=%d stats=%+v", frames, r.stats)
	}
}

func FuzzParsePacket(f *testing.F) {
	f.Add(ethTCP(masterIP, slaveIP, 50000, 502, 1, 0, tcpFrame(1, 1, 3, 0, 0, 0, 1), true, 80))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, pkt []byte) {
		r := newTCPReassembler(502)
		for _, lt := range []int{linkTypeNull, linkTypeEthernet, linkTypeRawIP} {
			if seg, ok := parsePacket(lt, pkt); ok {
				r.add(seg, time.Now())
			}
		}
	})
}
