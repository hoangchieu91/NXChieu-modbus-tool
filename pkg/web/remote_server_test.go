package web

import (
	"fmt"
	"io"
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
	s := NewRemoteServer(func(req RemoteWriteRequest) error {
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

func TestMobilePageIsSelfContained(t *testing.T) {
	s := NewRemoteServer(nil, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/mobile.css", s.handleMobileCSS)
	mux.HandleFunc("/", s.handleMobileWeb)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	get := func(path string) (int, string, string) {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header.Get("Content-Type"), string(body)
	}

	code, _, html := get("/")
	if code != http.StatusOK || strings.Contains(html, "cdn.") || !strings.Contains(html, `href="/mobile.css"`) {
		t.Fatalf("page must load only local assets (status %d)", code)
	}
	code, ctype, css := get("/mobile.css")
	if code != http.StatusOK || !strings.HasPrefix(ctype, "text/css") || !strings.Contains(css, ".bg-slate-950") {
		t.Fatalf("stylesheet not served correctly: status %d, type %q", code, ctype)
	}
	if code, _, _ := get("/nope"); code != http.StatusNotFound {
		t.Fatalf("unknown path should 404, got %d", code)
	}
}

// A phone write carries the typed text and sheet to the desktop handler, and the phone gets the
// handler's error back.
func TestRemoteWriteForwardsTextAndReportsResult(t *testing.T) {
	var got RemoteWriteRequest
	s := NewRemoteServer(func(req RemoteWriteRequest) error {
		got = req
		return fmt.Errorf("FC02/FC04 là bảng chỉ đọc")
	}, nil)
	s.config.AllowWrite = true
	s.token = "secret"
	s.isRunning = true
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws?t=secret", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	msg := `{"type":"write","tab_id":"tab-2","address":7,"is_coil":false,"text":"22.5"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatal(err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("no write_result: %v", err)
		}
		if !strings.Contains(string(data), "write_result") {
			continue
		}
		if !strings.Contains(string(data), `"success":false`) || !strings.Contains(string(data), "chỉ đọc") {
			t.Fatalf("error not reported to phone: %s", data)
		}
		break
	}
	if got.TabID != "tab-2" || got.Text != "22.5" || got.Address == nil || *got.Address != 7 {
		t.Fatalf("request not forwarded correctly: %+v", got)
	}
}
