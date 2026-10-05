package sniffer

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
)

// ProfileRegister defines the engineering mapping for a single Modbus register address.
type ProfileRegister struct {
	Address     uint16  `json:"address"`
	Name        string  `json:"name"`
	DataType    string  `json:"data_type"` // uint16, int16, uint32, int32, float32_abcd, float32_cdba, bool
	Scale       float64 `json:"scale"`
	Unit        string  `json:"unit"`
	Description string  `json:"description,omitempty"`
	// Table is "holding" (FC03/06/16/23) or "input" (FC04). Empty matches both, which keeps
	// profiles written before tables existed working unchanged.
	Table string `json:"table,omitempty"`
}

// Register tables a profile entry can belong to.
const (
	TableHolding = "holding"
	TableInput   = "input"
)

// registerTableForFC returns the register table a function code reads or writes, or "" for
// bit tables (coils, discrete inputs) and diagnostics, which profiles never map.
func registerTableForFC(fc uint8) string {
	switch fc {
	case 3, 6, 16, 22, 23:
		return TableHolding
	case 4:
		return TableInput
	}
	return ""
}

// DeviceProfile represents the register schema for one Modbus Unit ID.
type DeviceProfile struct {
	UnitID     uint8                      `json:"unit_id"`
	DeviceName string                     `json:"device_name"`
	Model      string                     `json:"model,omitempty"`
	Registers  []ProfileRegister          `json:"registers"`
	regIndex   map[string]ProfileRegister `json:"-"` // key: table|address
}

func regKey(table string, addr uint16) string { return fmt.Sprintf("%s|%d", table, addr) }

// ProfileCatalog holds multiple device profiles indexed by Unit ID.
type ProfileCatalog struct {
	Name    string                   `json:"name"`
	Version string                   `json:"version"`
	Devices map[uint8]*DeviceProfile `json:"devices"`
}

// EngineeringValue is a human-readable engineering reading derived from raw registers.
type EngineeringValue struct {
	Address      uint16  `json:"address"`
	Name         string  `json:"name"`
	Value        string  `json:"value"`
	NumericValue float64 `json:"numeric_value"`
	Unit         string  `json:"unit"`
}

// NewProfileCatalog initializes an empty catalog.
func NewProfileCatalog() *ProfileCatalog {
	return &ProfileCatalog{
		Name:    "Default Catalog",
		Version: "1.0",
		Devices: make(map[uint8]*DeviceProfile),
	}
}

// LoadProfileCatalog parses a JSON profile catalog.
func LoadProfileCatalog(data []byte) (*ProfileCatalog, error) {
	catalog := &ProfileCatalog{Devices: make(map[uint8]*DeviceProfile)}
	if err := json.Unmarshal(data, catalog); err != nil {
		return nil, fmt.Errorf("invalid profile catalog JSON: %w", err)
	}
	if err := validateProfileCatalog(catalog); err != nil {
		return nil, err
	}
	return catalog, nil
}

func validateProfileCatalog(catalog *ProfileCatalog) error {
	if catalog == nil {
		return fmt.Errorf("profile catalog is null")
	}
	if catalog.Devices == nil {
		catalog.Devices = make(map[uint8]*DeviceProfile)
	}
	allowedTypes := map[string]bool{
		"": true, "uint16": true, "int16": true, "uint32": true, "int32": true,
		"float": true, "float32": true, "float32_abcd": true, "float32_cdab": true, "float32_cdba": true, "bool": true,
	}
	for unitID, dev := range catalog.Devices {
		if dev == nil {
			return fmt.Errorf("profile for Unit %d is null", unitID)
		}
		if dev.UnitID != unitID {
			return fmt.Errorf("profile map key Unit %d does not match unit_id %d", unitID, dev.UnitID)
		}
		if len(dev.Registers) > maxProfileRegisters {
			return fmt.Errorf("Unit %d has %d registers (limit %d)", unitID, len(dev.Registers), maxProfileRegisters)
		}
		seen := make(map[string]struct{}, len(dev.Registers))
		for index, reg := range dev.Registers {
			dataType := strings.ToLower(strings.TrimSpace(reg.DataType))
			if !allowedTypes[dataType] {
				return fmt.Errorf("Unit %d register %d has unsupported data_type %q", unitID, reg.Address, reg.DataType)
			}
			tables, err := profileTables(reg.Table)
			if err != nil {
				return fmt.Errorf("Unit %d register %d: %w", unitID, reg.Address, err)
			}
			for _, table := range tables {
				key := regKey(table, reg.Address)
				if _, exists := seen[key]; exists {
					return fmt.Errorf("Unit %d contains duplicate %s register address %d (index %d)", unitID, table, reg.Address, index)
				}
				seen[key] = struct{}{}
			}
		}
		dev.BuildIndex()
	}
	return nil
}

const (
	// maxProfileFileSize and maxProfileRegisters keep a malformed or hostile profile from
	// exhausting memory; real catalogs are a few KB.
	maxProfileFileSize  = 4 << 20
	maxProfileRegisters = 65536
)

// LoadProfileCatalogFile loads a catalog from a disk file.
func LoadProfileCatalogFile(path string) (*ProfileCatalog, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxProfileFileSize {
		return nil, fmt.Errorf("profile file is %d bytes (limit %d)", info.Size(), maxProfileFileSize)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return LoadProfileCatalog(data)
}

// BuildIndex builds an address lookup index for the device profile.
func (dp *DeviceProfile) BuildIndex() {
	dp.regIndex = make(map[string]ProfileRegister, len(dp.Registers))
	for _, reg := range dp.Registers {
		if reg.Scale == 0 {
			reg.Scale = 1.0
		}
		tables, err := profileTables(reg.Table)
		if err != nil {
			continue // rejected by validation; never indexed
		}
		for _, table := range tables {
			dp.regIndex[regKey(table, reg.Address)] = reg
		}
	}
}

// profileTables expands a register's table field ("" means both register tables).
func profileTables(table string) ([]string, error) {
	switch strings.ToLower(strings.TrimSpace(table)) {
	case "":
		return []string{TableHolding, TableInput}, nil
	case TableHolding:
		return []string{TableHolding}, nil
	case TableInput:
		return []string{TableInput}, nil
	}
	return nil, fmt.Errorf("unsupported table %q (use holding or input)", table)
}

// GetRegister retrieves a register definition by address.
// GetRegister looks up a holding register (kept for callers without a table).
func (dp *DeviceProfile) GetRegister(addr uint16) (ProfileRegister, bool) {
	return dp.GetTableRegister(TableHolding, addr)
}

// GetTableRegister looks up a register in the given table.
func (dp *DeviceProfile) GetTableRegister(table string, addr uint16) (ProfileRegister, bool) {
	if dp.regIndex == nil {
		dp.BuildIndex()
	}
	reg, ok := dp.regIndex[regKey(table, addr)]
	return reg, ok
}

// DecodeEngineeringValues translates raw register values into engineering values according to the catalog.
// DecodeEngineeringValues maps holding registers (kept for callers without a function code).
func (pc *ProfileCatalog) DecodeEngineeringValues(unitID uint8, startAddress uint16, values []uint16) []EngineeringValue {
	return pc.decodeTable(unitID, TableHolding, startAddress, values)
}

// DecodeForFunction maps register values carried by a request/response of function code fc.
// FC04 uses the input-register table; bit tables (FC01/02/05/15) and diagnostics are never mapped.
func (pc *ProfileCatalog) DecodeForFunction(unitID, fc uint8, startAddress uint16, values []uint16) []EngineeringValue {
	table := registerTableForFC(fc)
	if table == "" {
		return nil
	}
	return pc.decodeTable(unitID, table, startAddress, values)
}

func (pc *ProfileCatalog) decodeTable(unitID uint8, table string, startAddress uint16, values []uint16) []EngineeringValue {
	if pc == nil || len(values) == 0 {
		return nil
	}
	dev, ok := pc.Devices[unitID]
	if !ok || dev == nil {
		return nil
	}

	results := make([]EngineeringValue, 0)
	i := 0
	for i < len(values) {
		currentAddr := startAddress + uint16(i)
		reg, exists := dev.GetTableRegister(table, currentAddr)
		if !exists {
			i++
			continue
		}

		dt := strings.ToLower(strings.TrimSpace(reg.DataType))
		scale := reg.Scale
		if scale == 0 {
			scale = 1.0
		}

		switch dt {
		case "bool":
			numeric := 0.0
			value := "false"
			if values[i] != 0 {
				numeric = 1
				value = "true"
			}
			results = append(results, EngineeringValue{
				Address: currentAddr, Name: reg.Name, Value: value,
				NumericValue: numeric, Unit: reg.Unit,
			})
			i++

		case "int16":
			rawSigned := int16(values[i])
			scaled := float64(rawSigned) * scale
			results = append(results, EngineeringValue{
				Address:      currentAddr,
				Name:         reg.Name,
				Value:        formatFloat(scaled),
				NumericValue: scaled,
				Unit:         reg.Unit,
			})
			i++

		case "uint32":
			if i+1 < len(values) {
				raw32 := (uint32(values[i]) << 16) | uint32(values[i+1])
				scaled := float64(raw32) * scale
				results = append(results, EngineeringValue{
					Address:      currentAddr,
					Name:         reg.Name,
					Value:        formatFloat(scaled),
					NumericValue: scaled,
					Unit:         reg.Unit,
				})
				i += 2
			} else {
				i++
			}

		case "int32":
			if i+1 < len(values) {
				raw32 := int32((uint32(values[i]) << 16) | uint32(values[i+1]))
				scaled := float64(raw32) * scale
				results = append(results, EngineeringValue{
					Address:      currentAddr,
					Name:         reg.Name,
					Value:        formatFloat(scaled),
					NumericValue: scaled,
					Unit:         reg.Unit,
				})
				i += 2
			} else {
				i++
			}

		case "float", "float32", "float32_abcd":
			if i+1 < len(values) {
				rawBits := (uint32(values[i]) << 16) | uint32(values[i+1])
				val := float64(math.Float32frombits(rawBits)) * scale
				results = append(results, EngineeringValue{
					Address:      currentAddr,
					Name:         reg.Name,
					Value:        formatFloat(val),
					NumericValue: val,
					Unit:         reg.Unit,
				})
				i += 2
			} else {
				i++
			}

		case "float32_cdab", "float32_cdba": // word-swapped (CDAB); "cdba" is the legacy name
			if i+1 < len(values) {
				rawBits := (uint32(values[i+1]) << 16) | uint32(values[i])
				val := float64(math.Float32frombits(rawBits)) * scale
				results = append(results, EngineeringValue{
					Address:      currentAddr,
					Name:         reg.Name,
					Value:        formatFloat(val),
					NumericValue: val,
					Unit:         reg.Unit,
				})
				i += 2
			} else {
				i++
			}

		default: // default is uint16
			raw := values[i]
			scaled := float64(raw) * scale
			results = append(results, EngineeringValue{
				Address:      currentAddr,
				Name:         reg.Name,
				Value:        formatFloat(scaled),
				NumericValue: scaled,
				Unit:         reg.Unit,
			})
			i++
		}
	}
	// A float register can hold NaN/Inf (FFFF FFFF is a common "sensor fault" value) and a huge
	// scale can overflow. JSON cannot carry NaN/Inf, and one such value would make every
	// snapshot and capture save fail, so show it as text and keep the number finite.
	for i := range results {
		v := results[i].NumericValue
		switch {
		case math.IsNaN(v):
			results[i].Value, results[i].NumericValue = "NaN", 0
		case math.IsInf(v, 1):
			results[i].Value, results[i].NumericValue = "+Inf", 0
		case math.IsInf(v, -1):
			results[i].Value, results[i].NumericValue = "-Inf", 0
		}
	}
	return results
}

func formatFloat(val float64) string {
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return "—"
	}
	if math.Abs(val-math.Round(val)) < 0.0001 {
		return fmt.Sprintf("%.0f", val)
	}
	return fmt.Sprintf("%.2f", val)
}
