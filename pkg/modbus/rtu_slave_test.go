package modbus

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func withCRC(b []byte) []byte {
	out := append([]byte(nil), b...)
	return binary.LittleEndian.AppendUint16(out, CRC16Modbus(b))
}

// startRTUPipe runs the slave RTU framer on one end of an in-memory connection.
func startRTUPipe(t *testing.T, slaveID uint8) (*ModbusSlaveServer, net.Conn) {
	t.Helper()
	srv := NewModbusSlaveServer("test", nil)
	srv.config.SlaveID = slaveID
	store := srv.GetMemoryStore()
	store.setSlaveID(slaveID)

	server, client := net.Pipe()
	go srv.handleRTUConnection(&tcpFrameReader{conn: server, silence: 50 * time.Millisecond}, store, "pipe")
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })
	return srv, client
}

func readResp(t *testing.T, c net.Conn, n int) []byte {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, n)
	got := 0
	for got < n {
		k, err := c.Read(buf[got:])
		if err != nil {
			t.Fatalf("read response: %v (got % X)", err, buf[:got])
		}
		got += k
	}
	return buf
}

func expectSilence(t *testing.T, c net.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	buf := make([]byte, 16)
	if n, err := c.Read(buf); err == nil {
		t.Fatalf("expected no response, got % X", buf[:n])
	}
}

func TestRTUSlaveFragmentedRead(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	req := BuildRTUReadRequest(1, 3, 0, 2)
	// Deliver the request in three fragments, as a serial port typically does.
	for _, part := range [][]byte{req[:3], req[3:5], req[5:]} {
		if _, err := c.Write(part); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}

	want := BuildRTURegisterResponse(1, 3, []uint16{2205, 512})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}
}

func TestRTUSlaveWriteMultipleRegisters(t *testing.T) {
	srv, c := startRTUPipe(t, 1)

	req := withCRC([]byte{1, 0x10, 0x00, 0x0A, 0x00, 0x02, 0x04, 0x12, 0x34, 0xAB, 0xCD})
	if _, err := c.Write(req); err != nil {
		t.Fatal(err)
	}
	want := withCRC([]byte{1, 0x10, 0x00, 0x0A, 0x00, 0x02})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}

	vals := srv.GetMemoryStore().GetSlice("holding", 10, 2).Values
	if vals[0] != 0x1234 || vals[1] != 0xABCD {
		t.Fatalf("registers not written: %v", vals)
	}
}

func TestRTUSlaveWriteMultipleCoils(t *testing.T) {
	srv, c := startRTUPipe(t, 1)

	// 10 coils starting at 20: 0b1100_1101, 0b01
	req := withCRC([]byte{1, 0x0F, 0x00, 0x14, 0x00, 0x0A, 0x02, 0xCD, 0x01})
	if _, err := c.Write(req); err != nil {
		t.Fatal(err)
	}
	want := withCRC([]byte{1, 0x0F, 0x00, 0x14, 0x00, 0x0A})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}

	got := srv.GetMemoryStore().GetSlice("coils", 20, 10).BoolValues
	exp := []bool{true, false, true, true, false, false, true, true, true, false}
	for i := range exp {
		if got[i] != exp[i] {
			t.Fatalf("coil %d = %v, want %v (all %v)", 20+i, got[i], exp[i], got)
		}
	}
}

func TestRTUSlaveBroadcastWriteIsSilent(t *testing.T) {
	srv, c := startRTUPipe(t, 1)

	if _, err := c.Write(withCRC([]byte{0, 0x06, 0x00, 0x05, 0x00, 0x63})); err != nil {
		t.Fatal(err)
	}
	expectSilence(t, c)

	if v := srv.GetMemoryStore().GetSlice("holding", 5, 1).Values[0]; v != 0x63 {
		t.Fatalf("broadcast write not applied: %d", v)
	}
}

func TestRTUSlaveOtherUnitIsSilent(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	if _, err := c.Write(BuildRTUReadRequest(7, 3, 0, 1)); err != nil {
		t.Fatal(err)
	}
	expectSilence(t, c)
}

func TestRTUSlaveQuantityTooLarge(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	if _, err := c.Write(BuildRTUReadRequest(1, 3, 0, 200)); err != nil {
		t.Fatal(err)
	}
	want := withCRC([]byte{1, 0x83, 0x03})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}
}

func TestRTUSlaveRecoversAfterGarbage(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	// Line noise followed immediately by a valid request.
	req := append([]byte{0xFF, 0x00}, BuildRTUReadRequest(1, 3, 1, 1)...)
	if _, err := c.Write(req); err != nil {
		t.Fatal(err)
	}
	want := BuildRTURegisterResponse(1, 3, []uint16{512})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}
}

func TestRTUSlaveFC03_128RegistersDoesNotPanic(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	// FC03 with quantity = 128 (128*2 = 256, which previously overflowed byte to 0 and caused slice panic)
	req := BuildRTUReadRequest(1, 3, 0, 128)
	if _, err := c.Write(req); err != nil {
		t.Fatal(err)
	}

	// Should safely return Modbus Exception 0x03 (Illegal Data Value) without panicking
	want := withCRC([]byte{1, 0x83, 0x03})
	if got := readResp(t, c, len(want)); !bytes.Equal(got, want) {
		t.Fatalf("got % X, want % X", got, want)
	}
}

func TestRTUSlaveMergedRequests(t *testing.T) {
	_, c := startRTUPipe(t, 1)

	req1 := BuildRTUReadRequest(1, 3, 0, 1)
	req2 := BuildRTUReadRequest(1, 3, 1, 1)
	merged := append(req1, req2...)

	if _, err := c.Write(merged); err != nil {
		t.Fatal(err)
	}

	want1 := BuildRTURegisterResponse(1, 3, []uint16{2205})
	want2 := BuildRTURegisterResponse(1, 3, []uint16{512})

	got1 := readResp(t, c, len(want1))
	if !bytes.Equal(got1, want1) {
		t.Fatalf("got1 % X, want1 % X", got1, want1)
	}

	got2 := readResp(t, c, len(want2))
	if !bytes.Equal(got2, want2) {
		t.Fatalf("got2 % X, want2 % X", got2, want2)
	}
}
