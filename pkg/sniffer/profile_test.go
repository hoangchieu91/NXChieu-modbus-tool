package sniffer

import (
	"encoding/hex"
	"math"
	"testing"
	"time"
)

func TestLoadProfileCatalogRejectsNullDevice(t *testing.T) {
	if _, err := LoadProfileCatalog([]byte(`{"devices":{"1":null}}`)); err == nil {
		t.Fatal("expected null device profile to be rejected")
	}
}

func TestProfileDecoding(t *testing.T) {
	jsonCatalog := `{
		"name": "Power Meter & Temp Catalog",
		"version": "1.0",
		"devices": {
			"1": {
				"unit_id": 1,
				"device_name": "Power Meter PM5350",
				"registers": [
					{"address": 100, "name": "Grid Voltage L1-N", "data_type": "float32_abcd", "scale": 1.0, "unit": "V"},
					{"address": 102, "name": "Grid Current L1", "data_type": "float32_cdba", "scale": 1.0, "unit": "A"},
					{"address": 104, "name": "Frequency", "data_type": "uint16", "scale": 0.01, "unit": "Hz"},
					{"address": 105, "name": "Ambient Temp", "data_type": "int16", "scale": 0.1, "unit": "°C"},
					{"address": 106, "name": "Active Energy Import", "data_type": "uint32", "scale": 0.001, "unit": "kWh"},
					{"address": 108, "name": "Reactive Power", "data_type": "int32", "scale": 1.0, "unit": "VAR"}
				]
			}
		}
	}`

	cat, err := LoadProfileCatalog([]byte(jsonCatalog))
	if err != nil {
		t.Fatalf("LoadProfileCatalog failed: %v", err)
	}

	// 1. Test Float32 ABCD (220.5 V)
	// IEEE 754 of 220.5: 0x435C8000 -> high word: 0x435C, low word: 0x8000
	rawBits := math.Float32bits(220.5)
	highWord := uint16(rawBits >> 16)
	lowWord := uint16(rawBits & 0xFFFF)
	vals := []uint16{highWord, lowWord}

	engVals := cat.DecodeEngineeringValues(1, 100, vals)
	if len(engVals) != 1 {
		t.Fatalf("Expected 1 eng val, got %d", len(engVals))
	}
	if engVals[0].Name != "Grid Voltage L1-N" || math.Abs(engVals[0].NumericValue-220.5) > 0.01 || engVals[0].Unit != "V" {
		t.Errorf("Unexpected eng val for float32_abcd: %+v", engVals[0])
	}

	// 2. Test Float32 CDBA (word-swapped, 15.75 A)
	// IEEE 754 of 15.75: 0x417C0000 -> normal high: 0x417C, normal low: 0x0000
	// in CDBA, registers stored as [0x0000, 0x417C]
	rawBits2 := math.Float32bits(15.75)
	valsCDBA := []uint16{uint16(rawBits2 & 0xFFFF), uint16(rawBits2 >> 16)}
	engVals2 := cat.DecodeEngineeringValues(1, 102, valsCDBA)
	if len(engVals2) != 1 {
		t.Fatalf("Expected 1 eng val, got %d", len(engVals2))
	}
	if engVals2[0].Name != "Grid Current L1" || math.Abs(engVals2[0].NumericValue-15.75) > 0.01 || engVals2[0].Unit != "A" {
		t.Errorf("Unexpected eng val for float32_cdba: %+v", engVals2[0])
	}

	// 3. Test uint16 with scale (5000 -> 50.00 Hz) and int16 negative (-150 -> -15.0 °C)
	// 0xFF6A is int16 -150
	engVals3 := cat.DecodeEngineeringValues(1, 104, []uint16{5000, 0xFF6A})
	if len(engVals3) != 2 {
		t.Fatalf("Expected 2 eng vals, got %d", len(engVals3))
	}
	if engVals3[0].Name != "Frequency" || math.Abs(engVals3[0].NumericValue-50.0) > 0.01 || engVals3[0].Unit != "Hz" {
		t.Errorf("Unexpected frequency: %+v", engVals3[0])
	}
	if engVals3[1].Name != "Ambient Temp" || math.Abs(engVals3[1].NumericValue-(-15.0)) > 0.01 || engVals3[1].Unit != "°C" {
		t.Errorf("Unexpected ambient temp: %+v", engVals3[1])
	}

	// 4. Test uint32 & int32
	// Active Energy: 1,000,000 * 0.001 = 1000 kWh. 1000000 = 0x000F4240 -> high 0x000F, low 0x4240
	// Reactive Power: -500 VAR. int32(-500) = 0xFFFFFE0C -> high 0xFFFF, low 0xFE0C
	engVals4 := cat.DecodeEngineeringValues(1, 106, []uint16{0x000F, 0x4240, 0xFFFF, 0xFE0C})
	if len(engVals4) != 2 {
		t.Fatalf("Expected 2 eng vals, got %d", len(engVals4))
	}
	if engVals4[0].Name != "Active Energy Import" || math.Abs(engVals4[0].NumericValue-1000.0) > 0.01 || engVals4[0].Unit != "kWh" {
		t.Errorf("Unexpected active energy: %+v", engVals4[0])
	}
	if engVals4[1].Name != "Reactive Power" || math.Abs(engVals4[1].NumericValue-(-500.0)) > 0.01 || engVals4[1].Unit != "VAR" {
		t.Errorf("Unexpected reactive power: %+v", engVals4[1])
	}
}

func TestEngineProfileIntegration(t *testing.T) {
	e := NewEngine(100)
	cat := NewProfileCatalog()
	dev := &DeviceProfile{
		UnitID:     2,
		DeviceName: "Sensor Node",
		Registers: []ProfileRegister{
			{Address: 300, Name: "Humidity", DataType: "uint16", Scale: 0.1, Unit: "%RH"},
			{Address: 301, Name: "Pressure", DataType: "uint16", Scale: 0.1, Unit: "hPa"},
		},
	}
	dev.BuildIndex()
	cat.Devices[2] = dev
	e.SetProfileCatalog(cat)

	now := time.Now()
	// Master request: Unit 2, FC 03, Addr 300 (0x012C), Qty 2 (0x0002) + CRC
	reqRaw, _ := hex.DecodeString("0203012c0002043b")
	f1 := e.AddRaw("test", DirectionMasterToSlave, reqRaw, QualityWire, now)
	if f1.ID == "" {
		t.Fatal("Failed to push request")
	}

	// Slave response: Unit 2, FC 03, ByteCount 4, Val1: 550 (0x0226 = 55.0%RH), Val2: 1013 (0x03F5 = 101.3 hPa) + CRC
	respRaw, _ := hex.DecodeString("020304022603f56a64")
	f2 := e.AddRaw("test", DirectionSlaveToMaster, respRaw, QualityWire, now.Add(20*time.Millisecond))
	if f2.ID == "" {
		t.Fatal("Failed to push response")
	}

	if f2.Parsed == nil {
		t.Fatal("Response frame not parsed")
	}
	if len(f2.Parsed.EngineeringValues) != 2 {
		t.Fatalf("Expected 2 engineering values in correlated response, got %d", len(f2.Parsed.EngineeringValues))
	}
	if f2.Parsed.EngineeringValues[0].Name != "Humidity" || f2.Parsed.EngineeringValues[0].Value != "55" || f2.Parsed.EngineeringValues[0].Unit != "%RH" {
		t.Errorf("Wrong humidity: %+v", f2.Parsed.EngineeringValues[0])
	}
	if f2.Parsed.EngineeringValues[1].Name != "Pressure" || f2.Parsed.EngineeringValues[1].Value != "101.30" || f2.Parsed.EngineeringValues[1].Unit != "hPa" {
		t.Errorf("Wrong pressure: %+v", f2.Parsed.EngineeringValues[1])
	}
}

func TestSetProfileCatalogMapsFramesAlreadyCaptured(t *testing.T) {
	e := NewEngine(10)
	now := time.Now()
	e.AddRaw("test", DirectionMasterToSlave, rtu(2, 3, 1, 44, 0, 1), QualityWire, now)
	e.AddRaw("test", DirectionSlaveToMaster, rtu(2, 3, 2, 2, 38), QualityWire, now.Add(time.Millisecond))

	cat := NewProfileCatalog()
	cat.Devices[2] = &DeviceProfile{UnitID: 2, Registers: []ProfileRegister{{Address: 300, Name: "Humidity", DataType: "uint16", Scale: 0.1, Unit: "%RH"}}}
	cat.Devices[2].BuildIndex()
	e.SetProfileCatalog(cat)

	frames := e.Snapshot(0).Frames
	if len(frames) != 2 || len(frames[1].Parsed.EngineeringValues) != 1 {
		t.Fatalf("profile was not applied to existing response: %+v", frames)
	}
	if got := frames[1].Parsed.EngineeringValues[0].NumericValue; math.Abs(got-55) > 0.001 {
		t.Fatalf("unexpected mapped value: %v", got)
	}
}
