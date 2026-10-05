//go:build !windows

package sniffer

import "fmt"

func listPcapDevices() ([]NetworkInterfaceInfo, error) {
	return nil, fmt.Errorf("passive packet capture is only implemented on Windows (Npcap)")
}

func openPcap(device, filter string) (pcapHandle, error) {
	return nil, fmt.Errorf("passive packet capture is only implemented on Windows (Npcap)")
}
