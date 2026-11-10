package modbus

import (
	"errors"
	"fmt"
	"strings"
	"time"

	simonmodbus "github.com/simonvetter/modbus"
)

// SlaveScanItem represents the probe outcome for a single Slave ID.
type SlaveScanItem struct {
	SlaveID   uint8  `json:"slave_id"`
	Status    string `json:"status"` // "online", "exception", "offline"
	Detail    string `json:"detail"`
	LatencyMs uint64 `json:"latency_ms"`
	RawRx     string `json:"raw_rx,omitempty"`
}

// BaudScanItem represents the probe outcome for a specific Baud/Parity combination.
type BaudScanItem struct {
	BaudRate  uint   `json:"baud_rate"`
	Parity    string `json:"parity"`
	StopBits  uint   `json:"stop_bits"`
	Success   bool   `json:"success"`
	LatencyMs uint64 `json:"latency_ms"`
	Detail    string `json:"detail"`
}

// RegisterScanItem represents the scan outcome for a single register.
type RegisterScanItem struct {
	Address uint16 `json:"address"`
	Valid   bool   `json:"valid"`
	Value   uint16 `json:"value"`
	Hex     string `json:"hex"`
	Detail  string `json:"detail"`
}

// isModbusExceptionError reports whether err is an exception response sent by the addressed
// device itself (so the device exists). Gateway exceptions 0x0A/0x0B mean the target did *not*
// answer, and OS errors such as "device busy" are not Modbus answers at all.
func isModbusExceptionError(err error) bool {
	var mbErr simonmodbus.Error
	if !errors.As(err, &mbErr) {
		return false
	}
	code, ok := exceptionCodes[mbErr]
	return ok && code != 0x0A && code != 0x0B
}

// ProbeSlave probes a single slave ID on the wrapper's active connection.
func (m *ModbusClientWrapper) ProbeSlave(slaveID uint8, timeoutMs uint) SlaveScanItem {
	m.mu.Lock()
	defer m.mu.Unlock()

	startTime := time.Now()

	// 1. Virtual Simulator Mode
	if m.isSimulator {
		time.Sleep(10 * time.Millisecond)
		// Simulate presence for ID 1 and ID 2
		if slaveID == 1 || slaveID == 2 {
			val := m.simRegisters[0]
			return SlaveScanItem{
				SlaveID:   slaveID,
				Status:    "online",
				Detail:    fmt.Sprintf("OK (Reg 0 = %d)", val),
				LatencyMs: uint64(time.Since(startTime).Milliseconds()),
				RawRx:     fmt.Sprintf("%02X 03 02 %04X ...", slaveID, val),
			}
		}
		return SlaveScanItem{
			SlaveID:   slaveID,
			Status:    "offline",
			Detail:    "No response (Timeout)",
			LatencyMs: 10,
		}
	}

	if !m.isConnected || m.client == nil {
		return SlaveScanItem{
			SlaveID:   slaveID,
			Status:    "offline",
			Detail:    "Client not connected",
			LatencyMs: 0,
		}
	}

	// 2. Hardware Live Client, using the timeout chosen in the scanner.
	m.lastProbeTime = time.Now()
	if timeoutMs > 0 {
		if err := m.setTimeoutLocked(time.Duration(timeoutMs) * time.Millisecond); err != nil {
			return SlaveScanItem{SlaveID: slaveID, Status: "offline", Detail: err.Error()}
		}
	}

	// Try reading Holding Register 0; if no response, also try Holding Register 1 and Input Register 0
	var val uint16
	var regAddr uint16 = 0
	var fc uint8 = 3
	txnBefore := m.txnID
	m.probing = true
	err := m.hardwareCallLocked(slaveID, func() (err error) {
		val, err = m.client.ReadRegister(0, simonmodbus.HOLDING_REGISTER)
		if err != nil && !isModbusExceptionError(err) {
			val, err = m.client.ReadRegister(1, simonmodbus.HOLDING_REGISTER)
			if err == nil {
				regAddr = 1
			}
		}
		if err != nil && !isModbusExceptionError(err) {
			val, err = m.client.ReadRegister(0, simonmodbus.INPUT_REGISTER)
			if err == nil {
				fc = 4
				regAddr = 0
			}
		}
		return err
	})
	m.probing = false
	m.lastProbeTime = time.Now()
	latency := uint64(time.Since(startTime).Milliseconds())

	// No request went out (link down / reconnecting): the ID was not probed, so it must not
	// be reported as an absent device.
	if err != nil && m.txnID == txnBefore {
		return SlaveScanItem{
			SlaveID:   slaveID,
			Status:    "error",
			Detail:    "Chưa dò được (liên kết lỗi): " + err.Error(),
			LatencyMs: latency,
		}
	}

	if err == nil {
		return SlaveScanItem{
			SlaveID:   slaveID,
			Status:    "online",
			Detail:    fmt.Sprintf("OK (FC%02d Reg %d = 0x%04X / %d)", fc, regAddr, val, val),
			LatencyMs: latency,
			RawRx:     fmt.Sprintf("%02X %02X 02 %04X ...", slaveID, fc, val),
		}
	}

	if isModbusExceptionError(err) {
		return SlaveScanItem{
			SlaveID:   slaveID,
			Status:    "exception",
			Detail:    fmt.Sprintf("Online (Exception: %s)", err.Error()),
			LatencyMs: latency,
		}
	}

	return SlaveScanItem{
		SlaveID:   slaveID,
		Status:    "offline",
		Detail:    "No response (Timeout)",
		LatencyMs: latency,
	}
}

// ScanSlaveRange sequentially probes a range of Slave IDs [startID, endID].
func (m *ModbusClientWrapper) ScanSlaveRange(startID, endID uint8, timeoutMs uint) []SlaveScanItem {
	var results []SlaveScanItem
	if startID < 1 {
		startID = 1
	}
	if endID < startID {
		endID = startID
	}
	if endID > 247 {
		endID = 247
	}

	for id := int(startID); id <= int(endID); id++ {
		res := m.ProbeSlave(uint8(id), timeoutMs)
		results = append(results, res)
	}

	return results
}

// ScanRegisters scans a range of registers [startAddr, endAddr] to detect available addresses.
func (m *ModbusClientWrapper) ScanRegisters(slaveID uint8, fc uint8, startAddr, endAddr uint16) []RegisterScanItem {
	var results []RegisterScanItem

	if endAddr < startAddr {
		endAddr = startAddr
	}
	// Limit max batch to 1000 to prevent locking UI
	if endAddr-startAddr > 1000 {
		endAddr = startAddr + 1000
	}

	regType := simonmodbus.HOLDING_REGISTER
	if fc == 4 {
		regType = simonmodbus.INPUT_REGISTER
	}

	okItem := func(addr, val uint16) RegisterScanItem {
		return RegisterScanItem{Address: addr, Valid: true, Value: val, Hex: fmt.Sprintf("0x%04X", val), Detail: "OK"}
	}

	// Scan in blocks of up to 125 registers. The lock is taken per request so polling,
	// writes and Disconnect are not blocked for the whole scan.
	const blockSize = 125
	for blockStart := int(startAddr); blockStart <= int(endAddr); blockStart += blockSize {
		blockEnd := blockStart + blockSize - 1
		if blockEnd > int(endAddr) {
			blockEnd = int(endAddr)
		}
		qty := uint16(blockEnd - blockStart + 1)

		m.mu.Lock()
		if m.isSimulator {
			for addr := blockStart; addr <= blockEnd; addr++ {
				uAddr := uint16(addr)
				val, ok := m.simRegisters[uAddr]
				if !ok {
					val = uAddr * 10
				}
				results = append(results, okItem(uAddr, val))
			}
			m.mu.Unlock()
			continue
		}

		if !m.isConnected || m.client == nil {
			m.mu.Unlock()
			for addr := blockStart; addr <= blockEnd; addr++ {
				results = append(results, RegisterScanItem{Address: uint16(addr), Valid: false, Detail: "Not connected"})
			}
			continue
		}

		var vals []uint16
		err := m.hardwareCallLocked(slaveID, func() (err error) {
			vals, err = m.client.ReadRegisters(uint16(blockStart), qty, regType)
			return err
		})
		m.mu.Unlock()

		if err == nil && len(vals) == int(qty) {
			for i, v := range vals {
				results = append(results, okItem(uint16(blockStart+i), v))
			}
			continue
		}
		// Only an exception (e.g. an invalid address inside the block) is worth narrowing down
		// register by register. A timeout would repeat for each of the 125 registers and could
		// block the scan for many minutes.
		if !isModbusExceptionError(err) {
			detail := "Không đọc được khối"
			if err != nil {
				detail = err.Error()
			}
			for addr := blockStart; addr <= blockEnd; addr++ {
				results = append(results, RegisterScanItem{Address: uint16(addr), Valid: false, Detail: detail})
			}
			continue
		}

		// The block contains an invalid address (or timed out): fall back to one register at a time.
		for addr := blockStart; addr <= blockEnd; addr++ {
			uAddr := uint16(addr)
			m.mu.Lock()
			if !m.isConnected || m.client == nil {
				m.mu.Unlock()
				results = append(results, RegisterScanItem{Address: uAddr, Valid: false, Detail: "Not connected"})
				continue
			}
			var val uint16
			err := m.hardwareCallLocked(slaveID, func() (err error) {
				val, err = m.client.ReadRegister(uAddr, regType)
				return err
			})
			m.mu.Unlock()

			if err == nil {
				results = append(results, okItem(uAddr, val))
			} else {
				results = append(results, RegisterScanItem{Address: uAddr, Valid: false, Detail: err.Error()})
			}
		}
	}

	return results
}

// AutoDetectBaudrate probes multiple Baudrate and Parity combinations on a serial port to find the device.
func AutoDetectBaudrate(port string, slaveID uint8, bauds []uint, parities []string) []BaudScanItem {
	var results []BaudScanItem

	if len(bauds) == 0 {
		bauds = []uint{9600, 19200, 115200, 38400, 4800, 2400, 57600}
	}
	if len(parities) == 0 {
		parities = []string{"none", "even", "odd"}
	}

	pLower := strings.ToLower(port)
	if pLower == "simulator" || pLower == "sim" {
		// Mock scan for simulator
		for _, b := range bauds {
			for _, p := range parities {
				success := (b == 9600 && p == "none")
				detail := "Timeout"
				if success {
					detail = "Device matched (ACK)"
				}
				results = append(results, BaudScanItem{
					BaudRate:  b,
					Parity:    p,
					StopBits:  1,
					Success:   success,
					LatencyMs: 12,
					Detail:    detail,
				})
				if success {
					return results
				}
			}
		}
		return results
	}

	formattedPort := normalizeSerialPort(port)

	for _, baud := range bauds {
		for _, parityStr := range parities {
			add := func(success bool, latency uint64, detail string) {
				results = append(results, BaudScanItem{
					BaudRate: baud, Parity: parityStr, StopBits: 1,
					Success: success, LatencyMs: latency, Detail: detail,
				})
			}

			client, err := simonmodbus.NewClient(&simonmodbus.ClientConfiguration{
				URL:      fmt.Sprintf("rtu://%s", formattedPort),
				Speed:    baud,
				DataBits: 8,
				Parity:   libParity(parityStr),
				StopBits: 1,
				Timeout:  160 * time.Millisecond,
			})
			if err != nil {
				add(false, 0, fmt.Sprintf("Config error: %v", err))
				continue
			}

			startTime := time.Now()
			if err := client.Open(); err != nil {
				// The port itself cannot be opened (missing, or held by a connected tab); other
				// baud/parity combinations would fail the same way.
				add(false, 0, fmt.Sprintf("Open error: %v", err))
				return results
			}

			client.SetUnitId(slaveID)
			// Probe read holding register 0
			val, readErr := client.ReadRegister(0, simonmodbus.HOLDING_REGISTER)
			latency := uint64(time.Since(startTime).Milliseconds())
			_ = client.Close()

			switch {
			case readErr == nil:
				add(true, latency, fmt.Sprintf("Success (Reg 0 = %d)", val))
				return results // Found matched baudrate!
			case isModbusExceptionError(readErr):
				add(true, latency, fmt.Sprintf("Found (Exception: %s)", readErr.Error()))
				return results // Also valid device response!
			default:
				add(false, latency, "No response (Timeout)")
			}
		}
	}

	return results
}

// DiscoveredDevice holds details about an automatically discovered Modbus slave device.
type DiscoveredDevice struct {
	Port         string `json:"port"`
	BaudRate     uint   `json:"baud_rate"`
	Parity       string `json:"parity"`
	StopBits     uint   `json:"stop_bits"`
	SlaveID      uint8  `json:"slave_id"`
	FunctionCode uint8  `json:"function_code"`
	Address      uint16 `json:"address"`
	Value        uint16 `json:"value"`
	LatencyMs    uint64 `json:"latency_ms"`
	Detail       string `json:"detail"`
}

// AutoDiscoverParams specifies the search parameters for full device auto-discovery.
type AutoDiscoverParams struct {
	Port        string   `json:"port"`
	Bauds       []uint   `json:"bauds,omitempty"`
	Parities    []string `json:"parities,omitempty"`
	SlaveIDs    []uint8  `json:"slave_ids,omitempty"`
	TimeoutMs   uint     `json:"timeout_ms,omitempty"`
	StopOnFirst bool     `json:"stop_on_first"`
}

// AutoDiscoverDevices scans an unknown port across bauds, parities, and slave IDs to identify devices.
func AutoDiscoverDevices(params AutoDiscoverParams, onProgress func(phase string, currentBaud uint, currentParity string, currentSlave uint8, foundCount int)) []DiscoveredDevice {
	var results []DiscoveredDevice

	bauds := params.Bauds
	if len(bauds) == 0 {
		bauds = []uint{9600, 19200, 115200, 38400, 4800, 57600}
	}
	parities := params.Parities
	if len(parities) == 0 {
		parities = []string{"none", "even", "odd"}
	}
	slaveIDs := params.SlaveIDs
	if len(slaveIDs) == 0 {
		// Common industrial default IDs
		slaveIDs = []uint8{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 20, 32, 100, 247}
	}
	timeoutMs := params.TimeoutMs
	if timeoutMs == 0 {
		timeoutMs = 120
	}

	pLower := strings.ToLower(params.Port)
	if pLower == "simulator" || pLower == "sim" {
		results = append(results, DiscoveredDevice{
			Port:         params.Port,
			BaudRate:     9600,
			Parity:       "none",
			StopBits:     1,
			SlaveID:      1,
			FunctionCode: 3,
			Address:      0,
			Value:        0,
			LatencyMs:    10,
			Detail:       "Thiết bị Simulator (Khớp 9600 8-N-1 ID:1)",
		})
		return results
	}

	formattedPort := normalizeSerialPort(params.Port)

	for _, baud := range bauds {
		for _, parityStr := range parities {
			client, err := simonmodbus.NewClient(&simonmodbus.ClientConfiguration{
				URL:      fmt.Sprintf("rtu://%s", formattedPort),
				Speed:    baud,
				DataBits: 8,
				Parity:   libParity(parityStr),
				StopBits: 1,
				Timeout:  time.Duration(timeoutMs) * time.Millisecond,
			})
			if err != nil {
				continue
			}

			if err := client.Open(); err != nil {
				// Port cannot be opened (busy or absent)
				return results
			}

			for _, slaveID := range slaveIDs {
				if onProgress != nil {
					onProgress("probing", baud, parityStr, slaveID, len(results))
				}

				client.SetUnitId(slaveID)
				startTime := time.Now()
				fc := uint8(3)
				addr := uint16(0)
				val, readErr := client.ReadRegister(0, simonmodbus.HOLDING_REGISTER)
				latency := uint64(time.Since(startTime).Milliseconds())

				if readErr != nil && !isModbusExceptionError(readErr) {
					// Fallback to Address 1 (many Chinese sensors start at 1)
					startTime = time.Now()
					val, readErr = client.ReadRegister(1, simonmodbus.HOLDING_REGISTER)
					latency = uint64(time.Since(startTime).Milliseconds())
					addr = 1
				}

				if readErr != nil && !isModbusExceptionError(readErr) {
					// Fallback to Input Register 0 (FC04)
					startTime = time.Now()
					val, readErr = client.ReadRegister(0, simonmodbus.INPUT_REGISTER)
					latency = uint64(time.Since(startTime).Milliseconds())
					fc = 4
					addr = 0
				}

				if readErr == nil {
					results = append(results, DiscoveredDevice{
						Port:         params.Port,
						BaudRate:     baud,
						Parity:       parityStr,
						StopBits:     1,
						SlaveID:      slaveID,
						FunctionCode: fc,
						Address:      addr,
						Value:        val,
						LatencyMs:    latency,
						Detail:       fmt.Sprintf("Tìm thấy thiết bị (FC%02d, Đ/chỉ: %d, Giá trị: %d)", fc, addr, val),
					})
					if params.StopOnFirst {
						_ = client.Close()
						return results
					}
				} else if isModbusExceptionError(readErr) {
					results = append(results, DiscoveredDevice{
						Port:         params.Port,
						BaudRate:     baud,
						Parity:       parityStr,
						StopBits:     1,
						SlaveID:      slaveID,
						FunctionCode: fc,
						Address:      addr,
						LatencyMs:    latency,
						Detail:       fmt.Sprintf("Khớp thiết bị (Modbus Exception: %s)", readErr.Error()),
					})
					if params.StopOnFirst {
						_ = client.Close()
						return results
					}
				}
			}

			_ = client.Close()
		}
	}

	return results
}

