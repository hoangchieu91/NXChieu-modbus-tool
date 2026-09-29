package modbus

import (
	"strings"

	simonmodbus "github.com/simonvetter/modbus"
	"go.bug.st/serial"
)

// normalizeSerialPort turns a UI port label ("COM49 (USB Serial)") into a device path. COM
// ports get the \\.\ prefix Windows needs for COM10 and above.
func normalizeSerialPort(port string) string {
	p := strings.TrimSpace(port)
	if idx := strings.Index(p, " "); idx != -1 {
		p = p[:idx]
	}
	if strings.HasPrefix(strings.ToUpper(p), "COM") && !strings.HasPrefix(p, `\\.\`) {
		return `\\.\` + strings.ToUpper(p)
	}
	return p
}

// libParity maps "none"/"even"/"odd" to the Modbus client's parity constant.
func libParity(parity string) uint {
	switch strings.ToLower(parity) {
	case "even":
		return simonmodbus.PARITY_EVEN
	case "odd":
		return simonmodbus.PARITY_ODD
	}
	return simonmodbus.PARITY_NONE
}

// serialParity maps "none"/"even"/"odd" to the serial port parity used by the slave server.
func serialParity(parity string) serial.Parity {
	switch strings.ToLower(parity) {
	case "even":
		return serial.EvenParity
	case "odd":
		return serial.OddParity
	}
	return serial.NoParity
}
