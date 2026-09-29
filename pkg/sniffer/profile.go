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
}

// DeviceProfile represents the register schema for one Modbus Unit ID.
type DeviceProfile struct {
	UnitID      uint8                      `json:"unit_id"`
	DeviceName  string                     `json:"device_name"`
	Model       string                     `json:"model,omitempty"`
	Registers   []ProfileRegister          `json:"registers"`
	regIndex    map[uint16]ProfileRegister `json:"-"`
}

// ProfileCatalog holds multiple device profiles indexed by Unit ID.
type ProfileCatalog struct {
	Name        string                   `json:"name"`
	Version     string                   `json:"version"`
	Devices     map[uint8]*DeviceProfile `json:"devices"`
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
	for _, dev := range catalog.Devices {
		dev.BuildIndex()
	}
	return catalog, nil
}

// LoadProfileCatalogFile loads a catalog from a disk file.
func LoadProfileCatalogFile(path string) (*ProfileCatalog, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return LoadProfileCatalog(data)
}

// BuildIndex builds an address lookup index for the device profile.
func (dp *DeviceProfile) BuildIndex() {
	dp.regIndex = make(map[uint16]ProfileRegister, len(dp.Registers))
	for _, reg := range dp.Registers {
		if reg.Scale == 0 {
			reg.Scale = 1.0
		}
		dp.regIndex[reg.Address] = reg
	}
}

// GetRegister retrieves a register definition by address.
func (dp *DeviceProfile) GetRegister(addr uint16) (ProfileRegister, bool) {
	if dp.regIndex == nil {
		dp.BuildIndex()
	}
	reg, ok := dp.regIndex[addr]
	return reg, ok
}

// DecodeEngineeringValues translates raw register values into engineering values according to the catalog.
func (pc *ProfileCatalog) DecodeEngineeringValues(unitID uint8, startAddress uint16, values []uint16) []EngineeringValue {
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
		reg, exists := dev.GetRegister(currentAddr)
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

		case "float32_cdba":
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
