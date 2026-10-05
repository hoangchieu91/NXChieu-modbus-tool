//go:build windows

package sniffer

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Minimal wpcap.dll (Npcap) binding through syscalls, so passive capture needs no cgo toolchain.

type pcapIf struct {
	next        *pcapIf
	name        *byte
	description *byte
	addresses   *pcapAddr
	flags       uint32
}

type pcapAddr struct {
	next      *pcapAddr
	addr      *sockaddrHeader
	netmask   *sockaddrHeader
	broadaddr *sockaddrHeader
	dstaddr   *sockaddrHeader
}

type sockaddrHeader struct {
	family uint16
	data   [14]byte // sockaddr_in: port (2) + IPv4 (4)
}

// pcapPktHdr matches struct pcap_pkthdr on Windows, where timeval uses 32-bit longs.
type pcapPktHdr struct {
	tvSec  int32
	tvUsec int32
	caplen uint32
	len    uint32
}

type bpfProgram struct {
	length uint32
	insns  *byte
}

var wpcap struct {
	once                                                                                      sync.Once
	err                                                                                       error
	findAllDevs, freeAllDevs, openLive, compile, setFilter, freeCode, nextEx, dataLink, close *windows.Proc
}

func loadWpcap() error {
	wpcap.once.Do(func() {
		// Npcap installs into System32\Npcap, which is not on the DLL search path; loading by full
		// path with an altered search path lets wpcap.dll find Packet.dll next to it.
		var dll *windows.DLL
		candidates := []string{filepath.Join(os.Getenv("SystemRoot"), "System32", "Npcap", "wpcap.dll"), "wpcap.dll"}
		for _, path := range candidates {
			handle, err := windows.LoadLibraryEx(path, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
			if err == nil {
				dll = &windows.DLL{Name: path, Handle: handle}
				break
			}
			wpcap.err = err
		}
		if dll == nil {
			wpcap.err = fmt.Errorf("không nạp được wpcap.dll (Npcap): %w", wpcap.err)
			return
		}
		wpcap.err = nil
		procs := map[string]**windows.Proc{
			"pcap_findalldevs": &wpcap.findAllDevs, "pcap_freealldevs": &wpcap.freeAllDevs,
			"pcap_open_live": &wpcap.openLive, "pcap_compile": &wpcap.compile,
			"pcap_setfilter": &wpcap.setFilter, "pcap_freecode": &wpcap.freeCode,
			"pcap_next_ex": &wpcap.nextEx, "pcap_datalink": &wpcap.dataLink, "pcap_close": &wpcap.close,
		}
		for name, target := range procs {
			proc, err := dll.FindProc(name)
			if err != nil {
				wpcap.err = fmt.Errorf("wpcap.dll thiếu hàm %s: %w", name, err)
				return
			}
			*target = proc
		}
	})
	return wpcap.err
}

func errbufString(buf []byte) string {
	if i := indexZero(buf); i >= 0 {
		return string(buf[:i])
	}
	return string(buf)
}

func indexZero(b []byte) int {
	for i, c := range b {
		if c == 0 {
			return i
		}
	}
	return -1
}

// listPcapDevices returns Npcap capture devices (\Device\NPF_{GUID}) with their description and
// IPv4 addresses, so the UI can show readable adapter names.
func listPcapDevices() ([]NetworkInterfaceInfo, error) {
	if err := loadWpcap(); err != nil {
		return nil, err
	}
	var devs *pcapIf
	errbuf := make([]byte, 256)
	r, _, _ := wpcap.findAllDevs.Call(uintptr(unsafe.Pointer(&devs)), uintptr(unsafe.Pointer(&errbuf[0])))
	if int32(r) != 0 {
		return nil, fmt.Errorf("pcap_findalldevs: %s", errbufString(errbuf))
	}
	defer wpcap.freeAllDevs.Call(uintptr(unsafe.Pointer(devs)))

	var out []NetworkInterfaceInfo
	index := 0
	for d := devs; d != nil; d = d.next {
		info := NetworkInterfaceInfo{
			Index:       index,
			Name:        windows.BytePtrToString(d.name),
			Description: windows.BytePtrToString(d.description),
			IsUp:        true,
			IsLoopback:  d.flags&0x1 != 0, // PCAP_IF_LOOPBACK
		}
		for a := d.addresses; a != nil; a = a.next {
			if a.addr != nil && a.addr.family == 2 { // AF_INET
				ip := a.addr.data[2:6]
				info.IPs = append(info.IPs, fmt.Sprintf("%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]))
			}
		}
		out = append(out, info)
		index++
	}
	return out, nil
}

type wpcapHandle struct {
	handle   uintptr
	linkType int
}

// openPcap opens a capture device with a BPF filter and a short read timeout, so the reader can
// notice Stop between packets.
func openPcap(device, filter string) (pcapHandle, error) {
	if err := loadWpcap(); err != nil {
		return nil, err
	}
	devicePtr, err := windows.BytePtrFromString(device)
	if err != nil {
		return nil, err
	}
	errbuf := make([]byte, 256)
	const snaplen, promiscuous, timeoutMs = 65535, 1, 100
	h, _, _ := wpcap.openLive.Call(uintptr(unsafe.Pointer(devicePtr)), snaplen, promiscuous, timeoutMs, uintptr(unsafe.Pointer(&errbuf[0])))
	if h == 0 {
		return nil, fmt.Errorf("pcap_open_live %s: %s", device, errbufString(errbuf))
	}
	handle := &wpcapHandle{handle: h}
	lt, _, _ := wpcap.dataLink.Call(h)
	handle.linkType = int(int32(lt))

	if filter != "" {
		filterPtr, err := windows.BytePtrFromString(filter)
		if err != nil {
			handle.Close()
			return nil, err
		}
		var program bpfProgram
		const optimize, netmaskUnknown = 1, 0xFFFFFFFF
		if r, _, _ := wpcap.compile.Call(h, uintptr(unsafe.Pointer(&program)), uintptr(unsafe.Pointer(filterPtr)), optimize, netmaskUnknown); int32(r) != 0 {
			handle.Close()
			return nil, fmt.Errorf("bộ lọc BPF không hợp lệ: %q", filter)
		}
		r, _, _ := wpcap.setFilter.Call(h, uintptr(unsafe.Pointer(&program)))
		wpcap.freeCode.Call(uintptr(unsafe.Pointer(&program)))
		if int32(r) != 0 {
			handle.Close()
			return nil, fmt.Errorf("không áp dụng được bộ lọc BPF %q", filter)
		}
	}
	return handle, nil
}

func (h *wpcapHandle) LinkType() int { return h.linkType }

// Next returns the next packet, (nil, nil) on read timeout, or an error when capture failed.
func (h *wpcapHandle) Next() ([]byte, error) {
	var hdr *pcapPktHdr
	var data *byte
	r, _, _ := wpcap.nextEx.Call(h.handle, uintptr(unsafe.Pointer(&hdr)), uintptr(unsafe.Pointer(&data)))
	switch int32(r) {
	case 1:
		if hdr == nil || data == nil || hdr.caplen == 0 {
			return nil, nil
		}
		// Copy out of the driver buffer, which is reused by the next call.
		return append([]byte(nil), unsafe.Slice(data, hdr.caplen)...), nil
	case 0:
		return nil, nil // read timeout
	default:
		return nil, fmt.Errorf("pcap_next_ex trả về %d (card mạng bị tắt hoặc tháo?)", int32(r))
	}
}

func (h *wpcapHandle) Close() {
	if h.handle != 0 {
		wpcap.close.Call(h.handle)
		h.handle = 0
	}
}
