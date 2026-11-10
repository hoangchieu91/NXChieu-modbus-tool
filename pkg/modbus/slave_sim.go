package modbus

import (
	"context"
	"math"
	"math/rand"
	"strings"
	"time"
)

// StartSimulation activates automatic mathematical or randomized fluctuation on selected registers.
func (s *ModbusSlaveServer) StartSimulation(config SimulationConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.simCancel != nil {
		s.simCancel()
		s.simCancel = nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.simCancel = cancel

	interval := time.Duration(config.IntervalMs) * time.Millisecond
	if interval < 100*time.Millisecond {
		// Clamp overly fast updates to the documented minimum. The previous fallback used one
		// second, making a requested 50 ms simulation appear completely inactive in the UI.
		interval = 100 * time.Millisecond
	}

	if s.store == nil {
		s.store = NewSlaveMemoryStore(s.sessionID, 1, s.onActivity)
	}
	store := s.store

	go func(simCtx context.Context, cfg SimulationConfig) {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		var angle float64 = 0.0
		var currentVal float64 = cfg.Min

		for {
			select {
			case <-simCtx.Done():
				return
			case <-ticker.C:
				switch strings.ToLower(cfg.Mode) {
				case "random":
					span := cfg.Max - cfg.Min
					if span <= 0 {
						span = 100
					}
					currentVal = cfg.Min + rand.Float64()*span

				case "sine":
					angle += 0.1
					if angle > 2*math.Pi {
						angle = 0
					}
					span := cfg.Max - cfg.Min
					if span <= 0 {
						span = 100
					}
					currentVal = cfg.Min + (span/2.0)*(1.0+math.Sin(angle))

				case "toggle":
					store.ToggleCoil(cfg.Table, cfg.Address)
					continue

				default: // "increment"
					step := cfg.Step
					if step <= 0 {
						step = 1
					}
					currentVal += step
					if cfg.Max > cfg.Min && currentVal > cfg.Max {
						currentVal = cfg.Min
					}
				}

				if currentVal < 0 {
					currentVal = 0
				}
				if currentVal > 65535 {
					currentVal = 65535
				}
				store.SetRegister(cfg.Table, cfg.Address, uint16(math.Round(currentVal)))
			}
		}
	}(ctx, config)
}

// StopSimulation halts background data simulation.
func (s *ModbusSlaveServer) StopSimulation() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.simCancel != nil {
		s.simCancel()
		s.simCancel = nil
	}
}
