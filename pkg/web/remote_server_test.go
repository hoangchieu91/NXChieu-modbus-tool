package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newTestServer(t *testing.T, allowWrite bool) (*RemoteServer, *httptest.Server, *int32) {
	t.Helper()
	var writes int32
	s := NewRemoteServer(func(tabID string, isCoil bool, addr uint16, val uint16, boolVal bool) error {
		atomic.AddInt32(&writes, 1)
		return nil
	}, nil)
	s.config.AllowWrite = allowWrite
	s.token = "secret"
	s.isRunning = true

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/api/write", s.handleAPIWrite)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return s, ts, &writes
}

func TestRemoteRejectsMissingToken(t *testing.T) {
	_, ts, writes := newTestServer(t, true)

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	if _, resp, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("websocket without token should be rejected, err=%v", err)
	}

	resp, err := http.Post(ts.URL+"/api/write", "application/json", strings.NewReader(`{"address":1,"value":2}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized || atomic.LoadInt32(writes) != 0 {
		t.Fatalf("write without token: status %d, writes %d", resp.StatusCode, *writes)
	}
}

func TestRemoteRejectsFormPost(t *testing.T) {
	_, ts, writes := newTestServer(t, true)

	resp, err := http.Post(ts.URL+"/api/write?t=secret", "text/plain", strings.NewReader(`{"address":1,"value":2}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnsupportedMediaType || atomic.LoadInt32(writes) != 0 {
		t.Fatalf("cross-site style post: status %d, writes %d", resp.StatusCode, *writes)
	}
}

func TestRemoteMalformedWriteDoesNotCrash(t *testing.T) {
	s, ts, writes := newTestServer(t, true)

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?t=secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	for _, msg := range []string{`{"type":"write"}`, `{"type":"write","address":"x"}`, `not json`} {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
			t.Fatal(err)
		}
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatal(err)
	}

	// Broadcast concurrently with the pong reply; a second writer used to panic.
	for i := 0; i < 20; i++ { // stays below clientSendBuffer so the pong is never dropped
		s.BroadcastState(map[string]interface{}{"i": i})
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	gotPong := false
	for !gotPong {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("connection dropped: %v", err)
		}
		gotPong = strings.Contains(string(data), "pong")
	}
	if atomic.LoadInt32(writes) != 0 {
		t.Fatalf("malformed writes must be ignored, got %d", *writes)
	}
}

func TestRemoteWriteDisabled(t *testing.T) {
	_, ts, writes := newTestServer(t, false)

	resp, err := http.Post(ts.URL+"/api/write?t=secret", "application/json", strings.NewReader(`{"address":1,"value":2}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || atomic.LoadInt32(writes) != 0 {
		t.Fatalf("status %d, writes %d", resp.StatusCode, *writes)
	}
}
