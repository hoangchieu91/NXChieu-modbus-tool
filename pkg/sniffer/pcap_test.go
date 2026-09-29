package sniffer

import (
	"testing"
)

func TestCheckNpcapStatus(t *testing.T) {
	status := CheckNpcapStatus()
	// Should at least return interfaces list (loopback or physical)
	if len(status.Interfaces) == 0 {
		t.Log("No network interfaces found (could be container/sandbox)")
	}
	if status.DownloadURL == "" || status.Instructions == "" {
		t.Error("Missing download URL or instructions in NpcapStatus")
	}
}

func TestSessionManagerPCAPValidation(t *testing.T) {
	engine := NewEngine(10)
	mgr := NewSessionManager(engine)

	// Test with missing interface
	_, err := mgr.Start(CaptureConfig{
		Mode:          ModePassivePCAP,
		InterfaceName: "",
	})
	if err == nil {
		t.Error("Expected error when starting PCAP without interface or without Npcap, got nil")
	}
}
