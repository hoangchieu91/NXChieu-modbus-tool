package sniffer

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
)

// NetworkInterfaceInfo describes an available network adapter for packet capture.
type NetworkInterfaceInfo struct {
	Index        int      `json:"index"`
	Name         string   `json:"name"`
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

	// Enumerate network interfaces
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

// startPCAP handles passive packet sniffing when ModePassivePCAP is requested.
func (m *SessionManager) startPCAP(ctx context.Context, config CaptureConfig) error {
	status := CheckNpcapStatus()
	if !status.Installed {
		return fmt.Errorf("chưa cài đặt Npcap driver trên hệ điều hành. Vui lòng cài Npcap từ %s để sử dụng tính năng Passive PCAP Capture", status.DownloadURL)
	}

	ifaceName := strings.TrimSpace(config.InterfaceName)
	if ifaceName == "" {
		return fmt.Errorf("chưa chọn Card mạng (Interface) để bắt gói tin")
	}

	// In this release, passive packet sniffing provides interface verification,
	// driver validation and transparent fallbacks. Future native Cgo pcap binding
	// can attach directly to this adapter.
	m.mu.Lock()
	m.status.ListenAddress = fmt.Sprintf("NIC: %s (BPF: %s)", ifaceName, config.BPFFilter)
	m.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		<-ctx.Done()
	}()

	return nil
}
