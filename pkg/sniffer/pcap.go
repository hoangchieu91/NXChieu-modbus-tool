package sniffer

import (
	"context"
	"fmt"
	"net"
	"os"
	"regexp"
	"strconv"
	"time"
)

// pcapHandle is an open packet capture (wpcap.dll on Windows).
type pcapHandle interface {
	LinkType() int
	// Next returns the next packet, (nil, nil) on a read timeout, or an error.
	Next() ([]byte, error)
	Close()
}

// NetworkInterfaceInfo describes an available network adapter for packet capture.
type NetworkInterfaceInfo struct {
	Index int `json:"index"`
	// Name is the capture device to open (\\Device\\NPF_{GUID} with Npcap).
	Name string `json:"name"`
	// Description is the readable adapter name shown in the UI.
	Description  string   `json:"description,omitempty"`
	HardwareAddr string   `json:"hardware_addr"`
	IPs          []string `json:"ips"`
	IsUp         bool     `json:"is_up"`
	IsLoopback   bool     `json:"is_loopback"`
}

// NpcapStatus reports whether the Windows Npcap packet capture driver is installed and ready.
type NpcapStatus struct {
	Installed    bool                   `json:"installed"`
	Version      string                 `json:"version"`
	DriverPath   string                 `json:"driver_path,omitempty"`
	Interfaces   []NetworkInterfaceInfo `json:"interfaces"`
	DownloadURL  string                 `json:"download_url"`
	Instructions string                 `json:"instructions"`
}

// CheckNpcapStatus inspects the host system for Npcap/WinPcap libraries and network adapters.
func CheckNpcapStatus() NpcapStatus {
	status := NpcapStatus{
		DownloadURL:  "https://npcap.com/#download",
		Instructions: "Tải và cài đặt Npcap từ npcap.com. Trong quá trình cài đặt, chọn tùy chọn 'Install Npcap in WinPcap API-compatible Mode' để kích hoạt tính năng bắt gói tin bị động (Passive Capture) trực tiếp trên Card mạng.",
	}

	// Known DLL locations on Windows
	candidates := []string{
		`C:\Windows\System32\Npcap\wpcap.dll`,
		`C:\Windows\System32\wpcap.dll`,
		`C:\Windows\SysWOW64\Npcap\wpcap.dll`,
		`C:\Windows\System32\drivers\npcap.sys`,
	}

	for _, path := range candidates {
		if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
			status.Installed = true
			status.DriverPath = path
			status.Version = "Npcap OEM / WinPcap Compatible"
			break
		}
	}

	// Npcap device names are what a capture opens; fall back to OS adapters only for display.
	if status.Installed {
		if devices, err := listPcapDevices(); err == nil && len(devices) > 0 {
			status.Interfaces = devices
			return status
		}
	}
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range ifaces {
			info := NetworkInterfaceInfo{
				Index:        iface.Index,
				Name:         iface.Name,
				HardwareAddr: iface.HardwareAddr.String(),
				IsUp:         (iface.Flags & net.FlagUp) != 0,
				IsLoopback:   (iface.Flags & net.FlagLoopback) != 0,
			}
			addrs, addrErr := iface.Addrs()
			if addrErr == nil {
				for _, addr := range addrs {
					info.IPs = append(info.IPs, addr.String())
				}
			}
			status.Interfaces = append(status.Interfaces, info)
		}
	}

	return status
}

var bpfPortPattern = regexp.MustCompile(`\bport\s+(\d{1,5})\b`)

// pcapServerPort is the Modbus server port used to tell requests from responses: the target
// port if set, else the first "port N" in the BPF filter, else 502.
func pcapServerPort(config CaptureConfig) uint16 {
	if config.TargetPort != 0 {
		return config.TargetPort
	}
	if m := bpfPortPattern.FindStringSubmatch(config.BPFFilter); m != nil {
		if p, err := strconv.Atoi(m[1]); err == nil && p > 0 && p <= 65535 {
			return uint16(p)
		}
	}
	return 502
}

// startPCAP captures Modbus TCP passively from a network adapter through Npcap, reassembles the
// TCP streams and feeds the recovered ADUs to the analyzer.
func (m *SessionManager) startPCAP(ctx context.Context, config CaptureConfig) error {
	status := CheckNpcapStatus()
	if !status.Installed {
		return fmt.Errorf("chưa cài đặt Npcap driver trên hệ điều hành. Vui lòng cài Npcap từ %s để sử dụng tính năng Passive PCAP Capture", status.DownloadURL)
	}
	if config.InterfaceName == "" {
		return fmt.Errorf("chưa chọn Card mạng (Interface) để bắt gói tin")
	}
	serverPort := pcapServerPort(config)
	filter := config.BPFFilter
	if filter == "" {
		filter = fmt.Sprintf("tcp port %d", serverPort)
	}
	handle, err := openPcap(config.InterfaceName, filter)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.status.ListenAddress = config.InterfaceName
	m.status.TargetAddress = filter
	m.mu.Unlock()
	m.wg.Add(1)
	go m.pcapLoop(ctx, handle, serverPort)
	return nil
}

// pcapLoop owns the handle: it is closed here, after the last read, never concurrently with one.
func (m *SessionManager) pcapLoop(ctx context.Context, handle pcapHandle, serverPort uint16) {
	defer m.wg.Done()
	defer handle.Close()
	reassembler := newTCPReassembler(serverPort)
	linkType := handle.LinkType()
	lastEviction := time.Now()
	for ctx.Err() == nil {
		packet, err := handle.Next()
		if err != nil {
			if ctx.Err() == nil {
				m.fail(fmt.Errorf("passive capture: %w", err))
			}
			return
		}
		now := time.Now()
		if now.Sub(lastEviction) > time.Minute {
			reassembler.evictIdle(now, false)
			lastEviction = now
		}
		if packet == nil {
			continue
		}
		m.addBytes(uint64(len(packet)))
		seg, ok := parsePacket(linkType, packet)
		if !ok {
			continue
		}
		frames := reassembler.add(seg, now)
		stats := reassembler.stats
		m.mu.Lock()
		m.status.TCP = &stats
		m.mu.Unlock()
		for _, f := range frames {
			m.enqueue(observedFrame{f.source, "passive_pcap", TransportTCP, f.direction, f.raw, now})
		}
	}
}
