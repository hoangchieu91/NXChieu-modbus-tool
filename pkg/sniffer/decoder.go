package sniffer

import (
	"encoding/binary"
	"fmt"
	"strings"
)

var functionNames = map[uint8]string{
	1: "Read Coils", 2: "Read Discrete Inputs", 3: "Read Holding Registers",
	4: "Read Input Registers", 5: "Write Single Coil", 6: "Write Single Register",
	7: "Read Exception Status", 8: "Diagnostics",
	15: "Write Multiple Coils", 16: "Write Multiple Registers",
	17: "Report Server ID", 22: "Mask Write Register", 23: "Read/Write Multiple Registers",
	43: "Read Device Identification",
}

var exceptionNames = map[uint8]string{
	1: "Illegal Function", 2: "Illegal Data Address", 3: "Illegal Data Value",
	4: "Server Device Failure", 5: "Acknowledge", 6: "Server Device Busy",
	8: "Memory Parity Error", 10: "Gateway Path Unavailable", 11: "Gateway Target Failed to Respond",
}

// Decode parses one complete Modbus RTU or TCP ADU. It never panics on malformed input.
func Decode(raw []byte, direction Direction) (Transport, *DecodedModbus, []DiagnosticItem) {
	return DecodeTransport(raw, detectTransport(raw), direction)
}

// DecodeTransport parses an ADU when the capture adapter already knows the transport. This is
// required for malformed MBAP frames and RTU-over-TCP, where content sniffing is ambiguous.
func DecodeTransport(raw []byte, transport Transport, direction Direction) (Transport, *DecodedModbus, []DiagnosticItem) {
	diagnostics := make([]DiagnosticItem, 0, 1)
	var unit uint8
	var pdu []byte
	decoded := &DecodedModbus{}

	if transport == TransportTCP {
		if len(raw) < 8 {
			return transport, nil, malformed("TCP frame ngắn hơn MBAP + function code")
		}
		txn := binary.BigEndian.Uint16(raw[0:2])
		decoded.TransactionID = &txn
		unit = raw[6]
		pdu = raw[7:]
		valid := binary.BigEndian.Uint16(raw[2:4]) == 0 && int(binary.BigEndian.Uint16(raw[4:6])) == len(raw)-6
		decoded.MBAPValid = &valid
		if !valid {
			diagnostics = append(diagnostics, DiagnosticItem{RuleID: "TCP_BAD_MBAP", Severity: "error", Message: "Protocol ID hoặc MBAP Length không hợp lệ", Confidence: 100})
		}
	} else {
		if len(raw) < 4 {
			return transport, nil, malformed("RTU frame quá ngắn")
		}
		unit = raw[0]
		pdu = raw[1 : len(raw)-2]
		want := binary.LittleEndian.Uint16(raw[len(raw)-2:])
		valid := crc16(raw[:len(raw)-2]) == want
		decoded.CRCValid = &valid
		if !valid {
			diagnostics = append(diagnostics, DiagnosticItem{RuleID: "RTU_BAD_CRC", Severity: "error", Message: "CRC-16 Modbus không khớp", Confidence: 100})
		}
	}

	if len(pdu) == 0 {
		return transport, nil, append(diagnostics, malformed("Thiếu function code")...)
	}
	decoded.UnitID = unit
	fc := pdu[0]
	if fc&0x80 != 0 {
		decoded.FunctionCode = fc & 0x7f
		decoded.FunctionName = functionName(decoded.FunctionCode)
		decoded.Kind = "exception"
		if len(pdu) < 2 {
			return transport, decoded, append(diagnostics, malformed("Exception response thiếu exception code")...)
		}
		code := pdu[1]
		decoded.ExceptionCode = &code
		decoded.ExceptionName = exceptionName(code)
		decoded.Summary = fmt.Sprintf("Slave %d · %s · %s", unit, decoded.FunctionName, decoded.ExceptionName)
		return transport, decoded, diagnostics
	}

	decoded.FunctionCode = fc
	decoded.FunctionName = functionName(fc)
	decoded.Kind = classifyKind(fc, pdu, direction)
	if err := decodeFields(decoded, pdu); err != nil {
		diagnostics = append(diagnostics, DiagnosticItem{RuleID: "MODBUS_MALFORMED", Severity: "error", Message: err.Error(), Confidence: 100})
	}
	decoded.Summary = buildSummary(decoded)
	return transport, decoded, diagnostics
}

// detectTransport guesses the transport of an internally captured ADU. A valid RTU CRC wins:
// many RTU frames also look like an MBAP header (e.g. "read 2 registers at 0":
// 01 03 00 00 00 02 C4 0B), while a TCP frame matching a CRC by chance is a 1/65536 event.
func detectTransport(raw []byte) Transport {
	if len(raw) >= 4 && crc16(raw[:len(raw)-2]) == binary.LittleEndian.Uint16(raw[len(raw)-2:]) {
		return TransportRTU
	}
	if len(raw) >= 8 && binary.BigEndian.Uint16(raw[2:4]) == 0 && int(binary.BigEndian.Uint16(raw[4:6])) == len(raw)-6 {
		return TransportTCP
	}
	return TransportRTU
}

func classifyKind(fc uint8, pdu []byte, direction Direction) string {
	if direction == DirectionMasterToSlave {
		return "request"
	}
	if direction == DirectionSlaveToMaster {
		return "response"
	}
	// When the layout fits both a request and a response, return "unknown" and let the engine
	// decide from the request it is waiting for.
	byteCountFits := len(pdu) >= 2 && int(pdu[1])+2 == len(pdu) && pdu[1] > 0
	pick := func(request, response bool) string {
		switch {
		case request && response:
			return "unknown"
		case request:
			return "request"
		case response:
			return "response"
		}
		return "unknown"
	}
	switch fc {
	case 1, 2:
		qty := 0
		if len(pdu) == 5 {
			qty = int(binary.BigEndian.Uint16(pdu[3:5]))
		}
		// FC01/02 responses with 3 data bytes (17-24 bits) are 5 bytes long, like a request.
		return pick(len(pdu) == 5 && qty >= 1 && qty <= 2000, byteCountFits)
	case 3, 4:
		return pick(len(pdu) == 5, byteCountFits && pdu[1]%2 == 0)
	case 7:
		if len(pdu) == 1 {
			return "request"
		}
		return "response"
	case 15, 16:
		if len(pdu) > 5 {
			return "request"
		}
		return "response"
	case 17:
		if len(pdu) == 1 {
			return "request"
		}
		return "response"
	case 23:
		// Request: fc, read addr/qty, write addr/qty, byte count (index 9), write values.
		request := len(pdu) >= 10 && len(pdu) == 10+int(pdu[9])
		return pick(request, byteCountFits && pdu[1]%2 == 0)
	case 43:
		if len(pdu) <= 4 {
			return "request"
		}
		return "response"
	case 5, 6, 8, 22:
		return "unknown" // request and response are byte-for-byte echoes
	default:
		return "unknown"
	}
}

func decodeFields(d *DecodedModbus, pdu []byte) error {
	if len(pdu) < 1 {
		return fmt.Errorf("PDU rỗng")
	}
	fc := pdu[0]
	switch fc {
	case 1, 2:
		if d.Kind == "request" {
			return decodeAddressQuantity(d, pdu)
		}
		if len(pdu) < 2 || int(pdu[1])+2 != len(pdu) {
			return fmt.Errorf("byte count của bit response không hợp lệ")
		}
		for _, b := range pdu[2:] {
			for bit := 0; bit < 8; bit++ {
				d.Bits = append(d.Bits, b&(1<<bit) != 0)
			}
		}
	case 3, 4:
		if d.Kind == "request" {
			return decodeAddressQuantity(d, pdu)
		}
		if len(pdu) < 2 || pdu[1]%2 != 0 || int(pdu[1])+2 != len(pdu) {
			return fmt.Errorf("byte count của register response không hợp lệ")
		}
		for i := 2; i+1 < len(pdu); i += 2 {
			d.Values = append(d.Values, binary.BigEndian.Uint16(pdu[i:i+2]))
		}
	case 5, 6:
		if len(pdu) != 5 {
			return fmt.Errorf("FC%02d phải có 4 byte dữ liệu", fc)
		}
		addr, value := binary.BigEndian.Uint16(pdu[1:3]), binary.BigEndian.Uint16(pdu[3:5])
		d.Address, d.Quantity, d.Values = &addr, uint16ptr(1), []uint16{value}
	case 15, 16:
		if d.Kind == "response" {
			return decodeAddressQuantity(d, pdu)
		}
		if len(pdu) < 6 {
			return fmt.Errorf("FC%02d request quá ngắn", fc)
		}
		addr, qty, byteCount := binary.BigEndian.Uint16(pdu[1:3]), binary.BigEndian.Uint16(pdu[3:5]), int(pdu[5])
		d.Address, d.Quantity = &addr, &qty
		if len(pdu) != 6+byteCount {
			return fmt.Errorf("byte count FC%02d không khớp payload", fc)
		}
		// Quantity and byte count must agree, within the protocol limits.
		if fc == 15 && (qty < 1 || qty > 1968 || byteCount != (int(qty)+7)/8) {
			return fmt.Errorf("FC15 quantity %d / byte count %d không hợp lệ", qty, byteCount)
		}
		if fc == 16 && (qty < 1 || qty > 123 || byteCount != 2*int(qty)) {
			return fmt.Errorf("FC16 quantity %d / byte count %d không hợp lệ", qty, byteCount)
		}
		if fc == 16 {
			if byteCount%2 != 0 {
				return fmt.Errorf("FC16 byte count phải là số chẵn")
			}
			for i := 6; i+1 < len(pdu); i += 2 {
				d.Values = append(d.Values, binary.BigEndian.Uint16(pdu[i:i+2]))
			}
		} else {
			for _, b := range pdu[6:] {
				for bit := 0; bit < 8 && len(d.Bits) < int(qty); bit++ {
					d.Bits = append(d.Bits, b&(1<<bit) != 0)
				}
			}
		}
	case 7:
		if d.Kind == "request" {
			if len(pdu) != 1 {
				return fmt.Errorf("FC07 request không được có payload thừa")
			}
			return nil
		}
		if len(pdu) != 2 {
			return fmt.Errorf("FC07 response cần đúng 1 byte status")
		}
		status := pdu[1]
		d.Values = []uint16{uint16(status)}
		for bit := 0; bit < 8; bit++ {
			d.Bits = append(d.Bits, status&(1<<bit) != 0)
		}
	case 8:
		if len(pdu) < 5 {
			return fmt.Errorf("FC08 diagnostics cần sub-function (2 byte) và data (2 byte)")
		}
		sub := binary.BigEndian.Uint16(pdu[1:3])
		data := binary.BigEndian.Uint16(pdu[3:5])
		// The sub-function is not a register address; leaving Address unset keeps diagnostics
		// data out of register profiles.
		d.SubFunction = &sub
		d.Values = []uint16{data}
	case 17:
		if d.Kind == "request" {
			if len(pdu) != 1 {
				return fmt.Errorf("FC17 request không được có payload thừa")
			}
			return nil
		}
		if len(pdu) < 2 {
			return fmt.Errorf("FC17 response thiếu byte count")
		}
		byteCount := int(pdu[1])
		if len(pdu) != 2+byteCount {
			return fmt.Errorf("FC17 byte count không khớp độ dài payload")
		}
		d.TextData = formatPrintableBytes(pdu[2:])
	case 22:
		if len(pdu) != 7 {
			return fmt.Errorf("FC22 mask write cần address (2 byte), AND mask (2 byte) và OR mask (2 byte)")
		}
		addr := binary.BigEndian.Uint16(pdu[1:3])
		andMask := binary.BigEndian.Uint16(pdu[3:5])
		orMask := binary.BigEndian.Uint16(pdu[5:7])
		d.Address = &addr
		d.AndMask = &andMask
		d.OrMask = &orMask
		d.Values = []uint16{andMask, orMask}
	case 23:
		if d.Kind == "request" {
			if len(pdu) < 10 {
				return fmt.Errorf("FC23 request quá ngắn")
			}
			rAddr := binary.BigEndian.Uint16(pdu[1:3])
			rQty := binary.BigEndian.Uint16(pdu[3:5])
			wAddr := binary.BigEndian.Uint16(pdu[5:7])
			wQty := binary.BigEndian.Uint16(pdu[7:9])
			byteCount := int(pdu[9])
			if len(pdu) != 10+byteCount {
				return fmt.Errorf("FC23 byte count không khớp payload")
			}
			if byteCount%2 != 0 || byteCount/2 != int(wQty) {
				return fmt.Errorf("FC23 write byte count không khớp số lượng register")
			}
			d.Address = &rAddr
			d.Quantity = &rQty
			d.WriteAddress = &wAddr
			d.WriteQuantity = &wQty
			for i := 10; i+1 < len(pdu); i += 2 {
				d.WriteValues = append(d.WriteValues, binary.BigEndian.Uint16(pdu[i:i+2]))
			}
			return nil
		}
		if len(pdu) < 2 || pdu[1]%2 != 0 || int(pdu[1])+2 != len(pdu) {
			return fmt.Errorf("FC23 response byte count không hợp lệ")
		}
		for i := 2; i+1 < len(pdu); i += 2 {
			d.Values = append(d.Values, binary.BigEndian.Uint16(pdu[i:i+2]))
		}
	case 43:
		if len(pdu) < 2 {
			return fmt.Errorf("FC43 thiếu MEI type")
		}
		meiType := pdu[1]
		sub := uint16(meiType)
		d.SubFunction = &sub
		if meiType == 0x0E { // Read Device Identification
			if d.Kind == "request" {
				if len(pdu) < 4 {
					return fmt.Errorf("FC43/14 request thiếu code hoặc object ID")
				}
				readCode := pdu[2]
				objectID := pdu[3]
				d.TextData = fmt.Sprintf("ReadCode:0x%02X Obj:0x%02X (%s)", readCode, objectID, meiObjectName(objectID))
				return nil
			}
			if len(pdu) < 7 {
				return fmt.Errorf("FC43/14 response quá ngắn")
			}
			conformity := pdu[3]
			numObjects := int(pdu[6])
			offset := 7
			var objParts []string
			for i := 0; i < numObjects && offset+2 <= len(pdu); i++ {
				objID := pdu[offset]
				objLen := int(pdu[offset+1])
				offset += 2
				if offset+objLen > len(pdu) {
					return fmt.Errorf("FC43/14 object payload bị cắt cụt")
				}
				val := string(pdu[offset : offset+objLen])
				offset += objLen
				objParts = append(objParts, fmt.Sprintf("%s=%q", meiObjectName(objID), val))
			}
			d.TextData = fmt.Sprintf("Conf:0x%02X [%s]", conformity, strings.Join(objParts, ", "))
		} else {
			d.TextData = fmt.Sprintf("MEI Type 0x%02X (%d bytes)", meiType, len(pdu)-2)
		}
	default:
		return fmt.Errorf("function code 0x%02X chưa có decoder chi tiết", fc)
	}
	return nil
}

func decodeAddressQuantity(d *DecodedModbus, pdu []byte) error {
	if len(pdu) != 5 {
		return fmt.Errorf("request/response cần đúng 4 byte address và quantity")
	}
	addr, qty := binary.BigEndian.Uint16(pdu[1:3]), binary.BigEndian.Uint16(pdu[3:5])
	d.Address, d.Quantity = &addr, &qty
	return nil
}

func buildSummary(d *DecodedModbus) string {
	parts := []string{fmt.Sprintf("Slave %d", d.UnitID), fmt.Sprintf("FC%02d %s", d.FunctionCode, d.FunctionName)}
	switch d.FunctionCode {
	case 7:
		if len(d.Values) > 0 {
			parts = append(parts, fmt.Sprintf("Status:0x%02X", d.Values[0]))
		}
	case 8:
		if d.SubFunction != nil {
			subName := diagnosticSubfunctionName(*d.SubFunction)
			if len(d.Values) > 0 {
				parts = append(parts, fmt.Sprintf("%s · Data:0x%04X", subName, d.Values[0]))
			} else {
				parts = append(parts, subName)
			}
		}
	case 17:
		if d.TextData != "" {
			parts = append(parts, d.TextData)
		}
	case 22:
		if d.Address != nil && d.AndMask != nil && d.OrMask != nil {
			parts = append(parts, fmt.Sprintf("@%d · AND:0x%04X · OR:0x%04X", *d.Address, *d.AndMask, *d.OrMask))
		}
	case 23:
		if d.Address != nil && d.Quantity != nil {
			parts = append(parts, fmt.Sprintf("Read @%d ×%d", *d.Address, *d.Quantity))
		}
		if d.WriteAddress != nil && d.WriteQuantity != nil {
			parts = append(parts, fmt.Sprintf("Write @%d ×%d", *d.WriteAddress, *d.WriteQuantity))
		}
		if len(d.Values) > 0 {
			parts = append(parts, fmt.Sprintf("%d read value(s)", len(d.Values)))
		}
	case 43:
		if d.TextData != "" {
			parts = append(parts, d.TextData)
		}
	default:
		if d.Address != nil {
			parts = append(parts, fmt.Sprintf("@%d", *d.Address))
		}
		if d.Quantity != nil {
			parts = append(parts, fmt.Sprintf("×%d", *d.Quantity))
		}
		if len(d.Values) > 0 {
			parts = append(parts, fmt.Sprintf("%d value(s)", len(d.Values)))
		}
	}
	return strings.Join(parts, " · ")
}

func diagnosticSubfunctionName(code uint16) string {
	switch code {
	case 0:
		return "Return Query Data (Echo)"
	case 1:
		return "Restart Comm Option"
	case 2:
		return "Return Diag Register"
	case 3:
		return "Change ASCII Input Delimiter"
	case 4:
		return "Force Listen Only Mode"
	case 10:
		return "Clear Counters & Diag Reg"
	case 11:
		return "Return Bus Message Count"
	case 12:
		return "Return Bus Comm Error Count"
	case 13:
		return "Return Bus Exception Error Count"
	case 14:
		return "Return Server Message Count"
	case 15:
		return "Return Server No Response Count"
	case 16:
		return "Return Server NAK Count"
	case 17:
		return "Return Server Busy Count"
	case 18:
		return "Return Bus Char Overrun Count"
	case 20:
		return "Clear Overrun Counter & Flag"
	default:
		return fmt.Sprintf("Subfunction 0x%04X", code)
	}
}

func meiObjectName(objID uint8) string {
	switch objID {
	case 0x00:
		return "VendorName"
	case 0x01:
		return "ProductCode"
	case 0x02:
		return "MajorMinorRevision"
	case 0x03:
		return "VendorUrl"
	case 0x04:
		return "ProductName"
	case 0x05:
		return "ModelName"
	case 0x06:
		return "UserApplicationName"
	default:
		return fmt.Sprintf("Obj0x%02X", objID)
	}
}

func formatPrintableBytes(data []byte) string {
	if len(data) == 0 {
		return "0 bytes"
	}
	allPrintable := true
	for _, b := range data {
		if b < 0x20 || b > 0x7E {
			allPrintable = false
			break
		}
	}
	if allPrintable && len(data) > 0 {
		return fmt.Sprintf("%q", string(data))
	}
	return fmt.Sprintf("%d bytes (hex: % X)", len(data), data)
}

func functionName(fc uint8) string {
	if name, ok := functionNames[fc]; ok {
		return name
	}
	return "Unknown Function"
}

func exceptionName(code uint8) string {
	if name, ok := exceptionNames[code]; ok {
		return name
	}
	return fmt.Sprintf("Unknown Exception 0x%02X", code)
}

func malformed(message string) []DiagnosticItem {
	return []DiagnosticItem{{RuleID: "MODBUS_MALFORMED", Severity: "error", Message: message, Confidence: 100}}
}

func uint16ptr(v uint16) *uint16 { return &v }

func crc16(data []byte) uint16 {
	crc := uint16(0xffff)
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xa001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
