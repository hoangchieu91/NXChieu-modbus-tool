package modbus

import (
	"encoding/binary"
	"errors"

	simonmodbus "github.com/simonvetter/modbus"
)

// Frames shown in the traffic sniffer. The library does not expose the bytes it sends, so they
// are rebuilt here in the exact wire format of the active transport:
//   - Modbus TCP: MBAP header (transaction ID, protocol 0, length, unit) + PDU, no CRC. The
//     transaction ID mirrors the library's counter, which starts at 0 on every Open and is
//     incremented once per request.
//   - RTU and RTU over TCP: unit + PDU + CRC16.

// tcpFrame converts an RTU ADU (unit + PDU + CRC) into a Modbus TCP ADU.
func tcpFrame(rtu []byte, txnID uint16) []byte {
	if len(rtu) < 4 {
		return nil
	}
	pdu := rtu[1 : len(rtu)-2]
	out := make([]byte, 7+len(pdu))
	binary.BigEndian.PutUint16(out[0:2], txnID)
	binary.BigEndian.PutUint16(out[2:4], 0) // protocol identifier
	binary.BigEndian.PutUint16(out[4:6], uint16(1+len(pdu)))
	out[6] = rtu[0]
	copy(out[7:], pdu)
	return out
}

// wireFrame returns the RTU ADU as it appears on the wire for the given link type.
func wireFrame(rtu []byte, isTCP bool, txnID uint16) []byte {
	if isTCP {
		return tcpFrame(rtu, txnID)
	}
	return rtu
}

// exceptionCodes maps library errors back to the exception code the device actually sent.
var exceptionCodes = map[simonmodbus.Error]byte{
	simonmodbus.ErrIllegalFunction:         0x01,
	simonmodbus.ErrIllegalDataAddress:      0x02,
	simonmodbus.ErrIllegalDataValue:        0x03,
	simonmodbus.ErrServerDeviceFailure:     0x04,
	simonmodbus.ErrAcknowledge:             0x05,
	simonmodbus.ErrServerDeviceBusy:        0x06,
	simonmodbus.ErrMemoryParityError:       0x08,
	simonmodbus.ErrGWPathUnavailable:       0x0A,
	simonmodbus.ErrGWTargetFailedToRespond: 0x0B,
}

// buildRTUExceptionResponse rebuilds the exception frame for a Modbus exception error, or
// returns nil when err is not an exception (timeout, I/O error: nothing was received).
func buildRTUExceptionResponse(slaveID, fc uint8, err error) []byte {
	var mbErr simonmodbus.Error
	if !errors.As(err, &mbErr) {
		return nil
	}
	code, ok := exceptionCodes[mbErr]
	if !ok {
		return nil
	}
	frame := []byte{slaveID, fc | 0x80, code}
	return binary.LittleEndian.AppendUint16(frame, CRC16Modbus(frame))
}
