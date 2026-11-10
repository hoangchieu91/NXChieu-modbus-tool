package web

import (
	"crypto/rand"
	_ "embed"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"nxchieu-modbus-tool/pkg/modbus"
)

// NetworkInterfaceInfo holds details about an IP address on the host machine.
type NetworkInterfaceInfo struct {
	Name        string `json:"name"`
	IP          string `json:"ip"`
	Type        string `json:"type"` // "vpn_tailscale", "vpn", "lan", "wifi", "other"
	Description string `json:"description"`
	URL         string `json:"url"`
}

// RemoteServerConfig holds settings for the Web Remote Server.
type RemoteServerConfig struct {
	Port       uint16 `json:"port"`        // Default 8088
	AllowWrite bool   `json:"allow_write"` // Allow remote writes from phone
	Token      string `json:"token"`       // Optional persistent or fixed token; generated if empty
}

// RemoteServerStatus returns live status of the web server.
type RemoteServerStatus struct {
	IsRunning     bool                   `json:"is_running"`
	Port          uint16                 `json:"port"`
	AllowWrite    bool                   `json:"allow_write"`
	ActiveClients int                    `json:"active_clients"`
	Token         string                 `json:"token"`
	Interfaces    []NetworkInterfaceInfo `json:"interfaces"`
}

// clientSendBuffer is the number of pending messages per phone before new ones are dropped.
const clientSendBuffer = 32

// remoteClient owns one WebSocket connection. Only its writer goroutine writes to conn,
// because gorilla/websocket does not support concurrent writers.
type remoteClient struct {
	conn *websocket.Conn
	send chan []byte
	once sync.Once
}

func (c *remoteClient) close() {
	c.once.Do(func() { close(c.send) })
}

// enqueue sends without blocking; a slow phone drops messages instead of stalling Modbus polling.
func (c *remoteClient) enqueue(msg []byte) {
	defer func() { _ = recover() }() // send on closed channel after disconnect
	select {
	case c.send <- msg:
	default:
	}
}

// RemoteServer bridges Modbus telemetry to phone browsers via WebSockets and HTTP.
type RemoteServer struct {
	mu            sync.RWMutex
	httpServer    *http.Server
	config        RemoteServerConfig
	token         string
	isRunning     bool
	clients       map[*remoteClient]bool
	lastState     json.RawMessage // last UI state; the envelope is rebuilt per send
	upgrader      websocket.Upgrader
	onRemoteWrite func(req RemoteWriteRequest) error
	activeStateFn func() map[string]interface{}
}

// NewRemoteServer creates an instance of RemoteServer.
func NewRemoteServer(
	onRemoteWrite func(req RemoteWriteRequest) error,
	activeStateFn func() map[string]interface{},
) *RemoteServer {
	return &RemoteServer{
		config: RemoteServerConfig{
			Port:       8088,
			AllowWrite: false,
		},
		clients:       make(map[*remoteClient]bool),
		onRemoteWrite: onRemoteWrite,
		activeStateFn: activeStateFn,
		// Default CheckOrigin rejects cross-origin pages, which blocks cross-site WebSocket hijacking.
		upgrader: websocket.Upgrader{},
	}
}

func newToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// GetNetworkInterfaces scans host network adapters and classifies LAN, WiFi, Tailscale and VPN IPs.
func GetNetworkInterfaces(port uint16, token string) []NetworkInterfaceInfo {
	var results []NetworkInterfaceInfo

	query := ""
	if token != "" {
		query = "/?t=" + token
	}

	interfaces, err := net.Interfaces()
	if err != nil {
		return results
	}

	for _, iface := range interfaces {
		// Ignore interfaces that are down
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			// Only handle IPv4 and ignore loopback 127.0.0.1
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}
			ip = ip.To4()

			ipStr := ip.String()
			// Ignore Windows auto-configured link-local APIPA 169.254.x.x
			if strings.HasPrefix(ipStr, "169.254.") {
				continue
			}

			ifaceNameLower := strings.ToLower(iface.Name)
			netType := "lan"
			desc := "Mạng Cục Bộ (LAN / Wi-Fi)"

			if strings.Contains(ifaceNameLower, "tailscale") || (ip[0] == 100 && (ip[1]&0xc0) == 64) {
				netType = "vpn_tailscale"
				desc = "🌐 Tailscale VPN (Truy Cập 4G Từ Xa)"
			} else if strings.Contains(ifaceNameLower, "wireguard") ||
				strings.Contains(ifaceNameLower, "openvpn") ||
				strings.Contains(ifaceNameLower, "nxchieu") ||
				strings.Contains(ifaceNameLower, "wg") ||
				(ip[0] == 10 && strings.Contains(ifaceNameLower, "pc")) {
				netType = "vpn"
				desc = "🔒 Mạng Riêng Ảo (VPN Nội Bộ)"
			} else if strings.Contains(ifaceNameLower, "wi-fi") || strings.Contains(ifaceNameLower, "wlan") || strings.Contains(ifaceNameLower, "wireless") {
				netType = "wifi"
				desc = "📶 Mạng Không Dây (Wi-Fi Xưởng / Hotspot)"
			} else if strings.Contains(ifaceNameLower, "ethernet") || strings.Contains(ifaceNameLower, "eth") {
				netType = "lan"
				desc = "🔌 Cáp Mạng Cục Bộ (Ethernet LAN)"
			}

			results = append(results, NetworkInterfaceInfo{
				Name:        iface.Name,
				IP:          ipStr,
				Type:        netType,
				Description: desc,
				URL:         fmt.Sprintf("http://%s:%d%s", ipStr, port, query),
			})
		}
	}

	// Always ensure at least localhost fallback
	if len(results) == 0 {
		results = append(results, NetworkInterfaceInfo{
			Name:        "Localhost",
			IP:          "127.0.0.1",
			Type:        "other",
			Description: "Máy Cục Bộ (Local Loopback)",
			URL:         fmt.Sprintf("http://127.0.0.1:%d%s", port, query),
		})
	}

	return results
}

// Start launches the HTTP and WebSocket server listening on 0.0.0.0:Port.
// A new access token is generated on every start; phones must present it (?t=...).
func (s *RemoteServer) Start(cfg RemoteServerConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isRunning {
		return nil
	}

	if cfg.Port == 0 {
		cfg.Port = 8088
	}

	startPort := cfg.Port
	var ln net.Listener
	var actualPort uint16
	for p := startPort; p <= startPort+30; p++ {
		addr := fmt.Sprintf("0.0.0.0:%d", p)
		l, err := net.Listen("tcp", addr)
		if err == nil {
			ln = l
			actualPort = p
			break
		}
	}
	if ln == nil {
		return fmt.Errorf("không thể mở cổng lắng nghe từ %d đến %d", startPort, startPort+30)
	}
	cfg.Port = actualPort

	s.config = cfg
	if cfg.Token != "" {
		s.token = cfg.Token
	} else {
		s.token = newToken()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/api/info", s.handleAPIInfo)
	mux.HandleFunc("/api/write", s.handleAPIWrite)
	mux.HandleFunc("/mobile.css", s.handleMobileCSS)
	mux.HandleFunc("/", s.handleMobileWeb)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	s.httpServer = server
	s.isRunning = true

	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			s.mu.Lock()
			if s.httpServer == server {
				s.isRunning = false
			}
			s.mu.Unlock()
		}
	}()

	return nil
}

// Stop gracefully shuts down the Web Remote Server.
func (s *RemoteServer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.isRunning || s.httpServer == nil {
		return
	}

	for c := range s.clients {
		c.close()
		_ = c.conn.Close()
	}
	s.clients = make(map[*remoteClient]bool)

	_ = s.httpServer.Close()
	s.httpServer = nil
	s.isRunning = false
	s.token = ""
}

// GetStatus returns the current live server status.
func (s *RemoteServer) GetStatus() RemoteServerStatus {
	s.mu.RLock()
	port := s.config.Port
	if port == 0 {
		port = 8088
	}
	status := RemoteServerStatus{
		IsRunning:     s.isRunning,
		Port:          port,
		AllowWrite:    s.config.AllowWrite,
		ActiveClients: len(s.clients),
		Token:         s.token,
	}
	s.mu.RUnlock()

	status.Interfaces = GetNetworkInterfaces(port, status.Token)
	return status
}

// authorized checks the access token passed as ?t=... using a constant-time compare.
func (s *RemoteServer) authorized(r *http.Request) bool {
	s.mu.RLock()
	token := s.token
	s.mu.RUnlock()
	given := r.URL.Query().Get("t")
	return token != "" && subtle.ConstantTimeCompare([]byte(given), []byte(token)) == 1
}

func (s *RemoteServer) allowWrite() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config.AllowWrite
}

// BroadcastPollResult sends telemetry update to all connected phone clients.
func (s *RemoteServer) BroadcastPollResult(sessionID string, res modbus.PollResult) {
	if !s.hasClients() {
		return
	}

	payload, err := json.Marshal(map[string]interface{}{
		"type":       "poll_data",
		"session_id": sessionID,
		"data":       res,
	})
	if err != nil {
		return
	}

	s.broadcastRaw(payload)
}

// BroadcastState sends full app state snapshot to clients and caches it for phones that connect later.
func (s *RemoteServer) BroadcastState(state map[string]interface{}) {
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.lastState = stateJSON
	s.mu.Unlock()

	payload, err := s.snapshotMessage(stateJSON)
	if err != nil {
		return
	}

	if s.hasClients() {
		s.broadcastRaw(payload)
	}
}

// snapshotMessage wraps a UI state with the server's *current* write permission. The state may
// have been cached before the server was (re)started with a different permission.
func (s *RemoteServer) snapshotMessage(state json.RawMessage) ([]byte, error) {
	return json.Marshal(map[string]interface{}{
		"type":        "state_snapshot",
		"state":       state,
		"allow_write": s.allowWrite(),
	})
}

func (s *RemoteServer) hasClients() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isRunning && len(s.clients) > 0
}

func (s *RemoteServer) broadcastRaw(payload []byte) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for c := range s.clients {
		c.enqueue(payload)
	}
}

func (s *RemoteServer) removeClient(c *remoteClient) {
	s.mu.Lock()
	delete(s.clients, c)
	s.mu.Unlock()
	c.close()
	_ = c.conn.Close()
}

// writePump is the only goroutine that writes to the client's connection.
func (s *RemoteServer) writePump(c *remoteClient) {
	defer s.removeClient(c)
	for msg := range c.send {
		_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

// RemoteWriteRequest is the payload of a remote write command (WebSocket or HTTP). Text is the
// value as typed on the phone; the desktop app encodes it with the row's format and scaling.
type RemoteWriteRequest struct {
	Type      string  `json:"type"`
	TabID     string  `json:"tab_id"`
	IsCoil    bool    `json:"is_coil"`
	Address   *uint16 `json:"address"`
	Value     uint16  `json:"value"`
	Text      string  `json:"text"`
	BoolValue bool    `json:"bool_value"`
}

func (s *RemoteServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	c := &remoteClient{conn: conn, send: make(chan []byte, clientSendBuffer)}

	s.mu.Lock()
	// Stop may have run during the upgrade (http.Server.Close does not close hijacked
	// connections), or a restart may have rotated the token: do not keep this phone.
	if !s.isRunning || s.token == "" || r.URL.Query().Get("t") != s.token {
		s.mu.Unlock()
		_ = conn.Close()
		return
	}
	s.clients[c] = true
	state := s.lastState
	s.mu.Unlock()

	if state == nil && s.activeStateFn != nil {
		state, _ = json.Marshal(s.activeStateFn())
	}
	if state != nil {
		if initMsg, err := s.snapshotMessage(state); err == nil {
			c.enqueue(initMsg)
		}
	}

	go s.writePump(c)

	// Read loop to handle client commands (ping, write)
	go func() {
		defer s.removeClient(c)
		conn.SetReadLimit(64 * 1024)

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var req RemoteWriteRequest
			if err := json.Unmarshal(msg, &req); err != nil {
				continue
			}

			switch req.Type {
			case "ping":
				c.enqueue([]byte(`{"type":"pong"}`))
			case "write":
				if !s.allowWrite() || s.onRemoteWrite == nil || req.Address == nil {
					continue
				}
				result := map[string]interface{}{"type": "write_result", "success": true, "address": *req.Address}
				if err := s.onRemoteWrite(req); err != nil {
					result["success"] = false
					result["error"] = err.Error()
				}
				if payload, err := json.Marshal(result); err == nil {
					c.enqueue(payload)
				}
			}
		}
	}()
}

func (s *RemoteServer) handleAPIInfo(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	status := s.GetStatus()
	status.Token = ""
	_ = json.NewEncoder(w).Encode(status)
}

func (s *RemoteServer) handleAPIWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !s.authorized(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Require a JSON content type so plain cross-site form posts are rejected.
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}

	if !s.allowWrite() {
		http.Error(w, "Remote write is disabled on server", http.StatusForbidden)
		return
	}

	var req RemoteWriteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == nil {
		http.Error(w, "address is required", http.StatusBadRequest)
		return
	}

	if s.onRemoteWrite != nil {
		if err := s.onRemoteWrite(req); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// Mobile web monitor, embedded into the binary so it works on isolated plant networks
// without internet access. mobile.css is prebuilt Tailwind: run `npm run build:mobile-css`
// after changing classes in mobile/index.html.
var (
	//go:embed mobile/index.html
	mobileHTML []byte
	//go:embed mobile/mobile.css
	mobileCSS []byte
)

// handleMobileWeb serves the embedded mobile web monitor application.
func (s *RemoteServer) handleMobileWeb(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(mobileHTML)
}

func (s *RemoteServer) handleMobileCSS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(mobileCSS)
}
