package sniffer

import (
	"math/rand"
	"testing"
	"time"
)

// One second of noise at 115200 baud (~11.5 KB, no silent gap) must be framed far faster than
// real time, or a noisy RS-485 bus saturates the capture goroutine.
func TestRTUFramerKeepsUpWithNoise(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	noise := make([]byte, 11520)
	rng.Read(noise)
	f := NewStreamFramer(TransportRTU)
	start := time.Now()
	for i := 0; i < len(noise); i += 32 {
		f.Feed(noise[i:minInt(i+32, len(noise))])
	}
	f.FlushGap()
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatalf("framing 1 s of 115200-baud noise took %v", elapsed)
	}
}
