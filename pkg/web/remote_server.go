package web

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
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
	Port            uint16 `json:"port"`               // Default 8088
	AllowWrite      bool   `json:"allow_write"`        // Allow remote writes from phone
	RequirePassword bool   `json:"require_password"`   // Future security
	Password        string `json:"password,omitempty"`
}

// RemoteServerStatus returns live status of the web server.
type RemoteServerStatus struct {
	IsRunning     bool                   `json:"is_running"`
	Port          uint16                 `json:"port"`
	AllowWrite    bool                   `json:"allow_write"`
	ActiveClients int                    `json:"active_clients"`
	Interfaces    []NetworkInterfaceInfo `json:"interfaces"`
}

// RemoteServer bridges Modbus telemetry to phone browsers via WebSockets and HTTP.
type RemoteServer struct {
	mu           sync.RWMutex
	httpServer   *http.Server
	config       RemoteServerConfig
	isRunning    bool
	clients      map[*websocket.Conn]bool
	clientCount  int64
	upgrader     websocket.Upgrader
	onRemoteWrite func(tabID string, isCoil bool, addr uint16, val uint16, boolVal bool) error
	activeStateFn func() map[string]interface{}
}

// NewRemoteServer creates an instance of RemoteServer.
func NewRemoteServer(
	onRemoteWrite func(tabID string, isCoil bool, addr uint16, val uint16, boolVal bool) error,
	activeStateFn func() map[string]interface{},
) *RemoteServer {
	return &RemoteServer{
		config: RemoteServerConfig{
			Port:       8088,
			AllowWrite: true,
		},
		clients:       make(map[*websocket.Conn]bool),
		onRemoteWrite: onRemoteWrite,
		activeStateFn: activeStateFn,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow connections from phone on LAN/VPN
			},
		},
	}
}

// GetNetworkInterfaces scans host network adapters and classifies LAN, WiFi, Tailscale and VPN IPs.
func GetNetworkInterfaces(port uint16) []NetworkInterfaceInfo {
	var results []NetworkInterfaceInfo

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
				URL:         fmt.Sprintf("http://%s:%d", ipStr, port),
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
			URL:         fmt.Sprintf("http://127.0.0.1:%d", port),
		})
	}

	return results
}

// Start launches the HTTP and WebSocket server listening on 0.0.0.0:Port.
func (s *RemoteServer) Start(cfg RemoteServerConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isRunning {
		return nil
	}

	if cfg.Port == 0 {
		cfg.Port = 8088
	}
	s.config = cfg

	mux := http.NewServeMux()

	// 1. WebSocket Handler
	mux.HandleFunc("/ws", s.handleWebSocket)

	// 2. Info API
	mux.HandleFunc("/api/info", s.handleAPIInfo)

	// 3. Write API
	mux.HandleFunc("/api/write", s.handleAPIWrite)

	// 4. Standalone Mobile Web UI (Embedded HTML/CSS/JS)
	mux.HandleFunc("/", s.handleMobileWeb)

	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	s.httpServer = server
	s.isRunning = true

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.mu.Lock()
			s.isRunning = false
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

	// Close all WebSocket clients
	for conn := range s.clients {
		_ = conn.Close()
	}
	s.clients = make(map[*websocket.Conn]bool)
	atomic.StoreInt64(&s.clientCount, 0)

	_ = s.httpServer.Close()
	s.httpServer = nil
	s.isRunning = false
}

// GetStatus returns the current live server status.
func (s *RemoteServer) GetStatus() RemoteServerStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	port := s.config.Port
	if port == 0 {
		port = 8088
	}

	return RemoteServerStatus{
		IsRunning:     s.isRunning,
		Port:          port,
		AllowWrite:    s.config.AllowWrite,
		ActiveClients: int(atomic.LoadInt64(&s.clientCount)),
		Interfaces:    GetNetworkInterfaces(port),
	}
}

// BroadcastPollResult sends telemetry update to all connected phone clients.
func (s *RemoteServer) BroadcastPollResult(sessionID string, res modbus.PollResult) {
	s.mu.RLock()
	if !s.isRunning || len(s.clients) == 0 {
		s.mu.RUnlock()
		return
	}

	payload, err := json.Marshal(map[string]interface{}{
		"type":       "poll_data",
		"session_id": sessionID,
		"data":       res,
	})
	s.mu.RUnlock()

	if err != nil {
		return
	}

	s.broadcastRaw(payload)
}

// BroadcastState sends full app state snapshot to clients.
func (s *RemoteServer) BroadcastState(state map[string]interface{}) {
	s.mu.RLock()
	if !s.isRunning || len(s.clients) == 0 {
		s.mu.RUnlock()
		return
	}

	payload, err := json.Marshal(map[string]interface{}{
		"type":  "state_snapshot",
		"state": state,
	})
	s.mu.RUnlock()

	if err != nil {
		return
	}

	s.broadcastRaw(payload)
}

func (s *RemoteServer) broadcastRaw(payload []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for conn := range s.clients {
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		err := conn.WriteMessage(websocket.TextMessage, payload)
		if err != nil {
			_ = conn.Close()
			delete(s.clients, conn)
			atomic.AddInt64(&s.clientCount, -1)
		}
	}
}

func (s *RemoteServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.clients[conn] = true
	atomic.AddInt64(&s.clientCount, 1)
	s.mu.Unlock()

	// Send initial state snapshot if available
	if s.activeStateFn != nil {
		state := s.activeStateFn()
		initMsg, _ := json.Marshal(map[string]interface{}{
			"type":  "state_snapshot",
			"state": state,
		})
		_ = conn.WriteMessage(websocket.TextMessage, initMsg)
	}

	// Read loop to handle client commands (ping, write, tab selection)
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.clients, conn)
			atomic.AddInt64(&s.clientCount, -1)
			s.mu.Unlock()
			_ = conn.Close()
		}()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}

			var req map[string]interface{}
			if err := json.Unmarshal(msg, &req); err == nil {
				msgType, _ := req["type"].(string)
				if msgType == "ping" {
					_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
				} else if msgType == "write" && s.config.AllowWrite && s.onRemoteWrite != nil {
					tabID, _ := req["tab_id"].(string)
					isCoil, _ := req["is_coil"].(bool)
					addr := uint16(req["address"].(float64))
					val := uint16(0)
					if v, ok := req["value"].(float64); ok {
						val = uint16(v)
					}
					boolVal, _ := req["bool_value"].(bool)
					_ = s.onRemoteWrite(tabID, isCoil, addr, val, boolVal)
				}
			}
		}
	}()
}

func (s *RemoteServer) handleAPIInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	status := s.GetStatus()
	_ = json.NewEncoder(w).Encode(status)
}

func (s *RemoteServer) handleAPIWrite(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !s.config.AllowWrite {
		http.Error(w, "Remote write is disabled on server", http.StatusForbidden)
		return
	}

	var req struct {
		TabID     string  `json:"tab_id"`
		IsCoil    bool    `json:"is_coil"`
		Address   uint16  `json:"address"`
		Value     uint16  `json:"value"`
		BoolValue bool    `json:"bool_value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if s.onRemoteWrite != nil {
		err := s.onRemoteWrite(req.TabID, req.IsCoil, req.Address, req.Value, req.BoolValue)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleMobileWeb serves the embedded mobile web monitor application.
func (s *RemoteServer) handleMobileWeb(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(embeddedMobileHTML))
}

// embeddedMobileHTML provides a beautiful, modern Dark Mode responsive Web App for phones.
const embeddedMobileHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>NXChieu Modbus Remote Monitor</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #020617; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    .flash-up { animation: flashUp 0.6s ease-out; }
    .flash-down { animation: flashDown 0.6s ease-out; }
    @keyframes flashUp { 0% { background-color: rgba(16, 185, 129, 0.4); } 100% { background-color: transparent; } }
    @keyframes flashDown { 0% { background-color: rgba(244, 63, 94, 0.4); } 100% { background-color: transparent; } }
  </style>
</head>
<body class="flex flex-col h-screen overflow-hidden select-none">
  <!-- Top Mobile Bar -->
  <header class="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between shrink-0 shadow-lg">
    <div class="flex items-center space-x-2">
      <div class="w-3 h-3 rounded-full bg-cyan-400 animate-pulse"></div>
      <div>
        <h1 class="text-sm font-bold tracking-wide text-white flex items-center gap-1.5">
          NXChieu Modbus <span class="text-[10px] bg-cyan-950 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-800 font-mono">Mobile</span>
        </h1>
        <p id="subStatus" class="text-[10px] text-slate-400 font-mono">Đang kết nối WebSocket...</p>
      </div>
    </div>
    <div class="flex items-center space-x-2">
      <span id="connBadge" class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-950 text-rose-400 border border-rose-800">
        OFFLINE
      </span>
    </div>
  </header>

  <!-- Sheet Switcher Tabs -->
  <nav id="sheetTabs" class="bg-slate-950 px-3 py-2 border-b border-slate-800/80 flex space-x-2 overflow-x-auto shrink-0 text-xs font-semibold">
    <button class="px-3 py-1.5 rounded-lg bg-cyan-600 text-white shadow-sm shrink-0">Sheet 1</button>
  </nav>

  <!-- KPI Top Cards (First 4 Registers Big View) -->
  <section id="kpiCards" class="grid grid-cols-2 gap-2 p-3 bg-slate-900/40 shrink-0 border-b border-slate-800/60">
    <!-- Populated by JS -->
  </section>

  <!-- Registers List (Mobile Card Table) -->
  <main class="flex-1 overflow-y-auto p-3 space-y-2" id="regContainer">
    <div class="text-center py-12 text-slate-500 text-xs">
      Đang chờ dữ liệu truyền về từ laptop...
    </div>
  </main>

  <!-- Bottom Mobile Status Footer -->
  <footer class="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono">
    <div class="flex items-center space-x-2">
      <span id="pingInfo">Ping: -- ms</span>
      <span>•</span>
      <span id="packetCount">Rx: 0</span>
    </div>
    <div id="lastUpdate">--:--:--</div>
  </footer>

  <script>
    let ws = null;
    let rxCount = 0;
    let prevValues = {};
    let currentTabId = '';
    let appSnapshot = null;

    function connectWS() {
      const loc = window.location;
      const wsUrl = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        document.getElementById('connBadge').className = 'px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800';
        document.getElementById('connBadge').innerText = 'ONLINE';
        document.getElementById('subStatus').innerText = 'Đã kết nối trực tiếp';
      };

      ws.onclose = () => {
        document.getElementById('connBadge').className = 'px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-950 text-rose-400 border border-rose-800';
        document.getElementById('connBadge').innerText = 'RECONNECTING';
        document.getElementById('subStatus').innerText = 'Mất kết nối. Tự thử lại sau 2s...';
        setTimeout(connectWS, 2000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          rxCount++;
          document.getElementById('packetCount').innerText = 'Rx: ' + rxCount;

          if (msg.type === 'state_snapshot') {
            appSnapshot = msg.state;
            renderTabs(msg.state.tabs || []);
            renderRows(msg.state.rows || []);
          } else if (msg.type === 'poll_data') {
            document.getElementById('lastUpdate').innerText = msg.data.timestamp || '--:--:--';
            document.getElementById('pingInfo').innerText = 'Độ trễ: ' + (msg.data.latency_ms || 0) + ' ms';
            if (msg.data.rows) {
              renderRows(msg.data.rows);
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
    }

    function renderTabs(tabs) {
      const bar = document.getElementById('sheetTabs');
      if (!tabs || tabs.length === 0) return;
      bar.innerHTML = '';
      tabs.forEach((t, i) => {
        const btn = document.createElement('button');
        const isActive = t.id === currentTabId || (i === 0 && !currentTabId);
        if (isActive) currentTabId = t.id;
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition ' + 
          (isActive ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white');
        btn.innerText = t.title || ('Sheet ' + (i + 1));
        btn.onclick = () => {
          currentTabId = t.id;
          renderTabs(tabs);
        };
        bar.appendChild(btn);
      });
    }

    function renderRows(rows) {
      if (!rows || rows.length === 0) return;
      const kpi = document.getElementById('kpiCards');
      const list = document.getElementById('regContainer');

      // 1. Render First 4 Rows as KPI Cards
      const kpiItems = rows.slice(0, 4);
      kpi.innerHTML = '';
      kpiItems.forEach((r) => {
        const prev = prevValues[r.address] ?? r.rawValue;
        let changeClass = '';
        if (typeof r.rawValue === 'number' && typeof prev === 'number' && r.rawValue !== prev) {
          changeClass = r.rawValue > prev ? 'flash-up' : 'flash-down';
        }
        prevValues[r.address] = r.rawValue;

        const card = document.createElement('div');
        card.className = 'p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 relative overflow-hidden ' + changeClass;
        card.innerHTML = 
          '<div class="text-[10px] text-slate-400 truncate font-sans font-medium">' + (r.alias || ('Reg ' + r.address)) + '</div>' +
          '<div class="text-lg font-bold font-mono text-cyan-300 mt-0.5 truncate">' + (r.displayValue || '--') + ' <span class="text-xs text-slate-400 font-sans font-normal">' + (r.unit || '') + '</span></div>' +
          '<div class="text-[9px] text-slate-600 font-mono mt-0.5">' + (r.displayAddress || '') + '</div>';
        kpi.appendChild(card);
      });

      // 2. Render Full List
      list.innerHTML = '';
      rows.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex items-center justify-between shadow-sm';
        item.innerHTML = 
          '<div class="flex-1 min-w-0 pr-3">' +
            '<div class="flex items-center space-x-1.5">' +
              '<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-bold">' + (r.displayAddress || r.address) + '</span>' +
              '<span class="text-xs font-semibold text-slate-200 truncate font-sans">' + (r.alias || 'Chưa đặt tên') + '</span>' +
            '</div>' +
            '<div class="text-[10px] text-slate-500 font-mono mt-1">Hex: <span class="text-emerald-400">' + (r.rawHex || '--') + '</span></div>' +
          '</div>' +
          '<div class="text-right">' +
            '<div class="text-base font-bold font-mono text-amber-300">' + (r.displayValue || '--') + '</div>' +
            '<div class="text-[10px] text-slate-400 font-sans">' + (r.unit || '') + '</div>' +
          '</div>';
        list.appendChild(item);
      });
    }

    // Ping interval every 5s to keep WebSocket alive through mobile NAT
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);

    connectWS();
  </script>
</body>
</html>
`
