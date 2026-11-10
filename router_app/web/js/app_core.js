// ============================================================================
// NXChieu Modbus Studio Pro v3.3 — Core App, Polling Engine & Mobile Native UI
// File: router_app/web/js/app_core.js
// ============================================================================

const STANDARD_BAUDS = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200,
  28800, 38400, 56000, 57600, 115200, 128000, 230400, 256000, 460800, 921600
];

let globalSerial = {
  port: "/dev/ttyCH0",
  baud: 9600,
  parity: "N",
  stopbits: 1
};

let availablePortsCache = [
  { id: "/dev/ttyCH0", label: "COM 1 — /dev/ttyCH0 (Bộ 8 Cổng CH348 #1)", is_ch348: true, is_external: true }
];

let portAliasesCache = {};
let activeGatewaysCache = [];
let smartRouterCache = { running: false, tcp_port: 5000 };
let comBridgesCache = [];
let datalogChannelsList = [];
let sdProfilesCache = [];
let currentProfileName = "NXChieu_MultiPort_Profile";
let firstPortSyncDone = false;
let savedTabsHydrated = false;
let toastTimer = null;

// Mobile Native App & Progressive Disclosure State
let isMobileCardView = (typeof window !== 'undefined' && window.innerWidth <= 820);
let isMobileConfigCollapsed = (typeof window !== 'undefined' && window.innerWidth <= 820);
let isHeaderDetailsOpen = false;
let isTabExtraToolsOpen = false;
let isPollAdvancedOpen = false;
let isSdHeaderToolsOpen = false;
let isSdInspectorAdvancedOpen = false;
let isQbPresetsOpen = false;
let isDesktopSidebarCollapsed = false;
let inspectorWidthPx = 380;
let inspectorUndoStack = [];

let activeSubTabs = {
  scanner: "range",
  gateway: "multi",
  datalog: "cfg",
  aidoc: "schema",
  sdInsp: "visual"
};

const UI_STATE_STORAGE_KEY = "nxmodbus_ui_state_v33";
let isRestoringUiState = false;

function saveUiStateToStorage() {
  if (isRestoringUiState) return;
  try {
    const serializedTabs = (sessionTabs || []).map(t => ({
      id: t.id,
      name: t.name,
      port: t.port,
      baud: t.baud,
      parity: t.parity || "N",
      stopbits: t.stopbits || 1,
      slave_id: t.slave_id,
      fn_code: t.fn_code,
      start_addr: t.start_addr,
      count: t.count,
      disabled_addrs: Array.isArray(t.disabled_addrs) ? t.disabled_addrs : Array.from(parseAddrRangeSet(t.disabled_addrs)),
      read_only_addrs: Array.isArray(t.read_only_addrs) ? t.read_only_addrs : Array.from(parseAddrRangeSet(t.read_only_addrs)),
      writable_addrs: Array.isArray(t.writable_addrs) ? t.writable_addrs : Array.from(parseAddrRangeSet(t.writable_addrs)),
      only_tagged: Boolean(t.only_tagged),
      format: t.format || "uint16",
      scan_ms: t.scan_ms || 1000,
      auto_poll: Boolean(t.isPolling || t.auto_poll),
      tags: t.tags || {},
      units: t.units || {},
      scales: t.scales || {},
      controls: t.controls || {},
      selectedIndex: t.selectedIndex || 0
    }));
    const payload = {
      currentView: currentView || "poll",
      activeTabId: activeTabId || (serializedTabs[0] && serializedTabs[0].id) || "tab_1",
      currentProfileName: currentProfileName || "NXChieu_MultiPort_Profile",
      sessionTabs: serializedTabs,
      trendWatches: typeof trendWatches !== 'undefined' ? trendWatches : [],
      trendStudioDisplayMode: typeof trendStudioDisplayMode !== 'undefined' ? trendStudioDisplayMode : "both",
      trendGridCols: typeof trendGridCols !== 'undefined' ? trendGridCols : "auto",
      trendWindowPoints: typeof trendWindowPoints !== 'undefined' ? trendWindowPoints : 60,
      trendNormalizedScale: typeof trendNormalizedScale !== 'undefined' ? Boolean(trendNormalizedScale) : false,
      sdStudioSelectedFilename: typeof sdStudioSelectedFilename !== 'undefined' ? sdStudioSelectedFilename : "",
      sdStudioActiveTabIdx: typeof sdStudioActiveTabIdx !== 'undefined' ? sdStudioActiveTabIdx : 0,
      activeSubTabs: activeSubTabs,
      isHeaderDetailsOpen: Boolean(isHeaderDetailsOpen),
      isTabExtraToolsOpen: Boolean(isTabExtraToolsOpen),
      isPollAdvancedOpen: Boolean(isPollAdvancedOpen),
      isSdHeaderToolsOpen: Boolean(isSdHeaderToolsOpen),
      isSdInspectorAdvancedOpen: Boolean(isSdInspectorAdvancedOpen),
      isMobileConfigCollapsed: Boolean(isMobileConfigCollapsed),
      isMobileCardView: Boolean(isMobileCardView),
      isDesktopSidebarCollapsed: Boolean(isDesktopSidebarCollapsed),
      inspectorWidthPx: Number(inspectorWidthPx) || 380
    };
    localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {}
}

function restoreUiStateFromStorage() {
  isRestoringUiState = true;
  try {
    const raw = localStorage.getItem(UI_STATE_STORAGE_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      if (st.currentProfileName) currentProfileName = st.currentProfileName;
      if (Array.isArray(st.sessionTabs) && st.sessionTabs.length > 0) {
        sessionTabs = st.sessionTabs.map((t, idx) => ({
          id: t.id || `tab_${idx + 1}`,
          name: t.name || `Phiên Đo ${idx + 1}`,
          port: t.port || globalSerial.port,
          baud: parseInt(t.baud) || 9600,
          parity: (t.parity || "N").toUpperCase(),
          stopbits: parseInt(t.stopbits) || 1,
          slave_id: parseInt(t.slave_id) || 1,
          fn_code: parseInt(t.fn_code) || 3,
          start_addr: parseInt(t.start_addr) || 0,
          count: Math.max(1, Math.min(250, parseInt(t.count) || 10)),
          disabled_addrs: Array.isArray(t.disabled_addrs) ? t.disabled_addrs : [],
          read_only_addrs: Array.isArray(t.read_only_addrs) ? t.read_only_addrs : [],
          writable_addrs: Array.isArray(t.writable_addrs) ? t.writable_addrs : [],
          only_tagged: Boolean(t.only_tagged),
          format: t.format || "uint16",
          scan_ms: parseInt(t.scan_ms) || 1000,
          isPolling: false,
          timer: null,
          values: [],
          rawHexs: [],
          lastUpdatedMap: {},
          lastPollState: "idle",
          lastError: "",
          blockErrors: [],
          tags: t.tags || {},
          units: t.units || {},
          scales: t.scales || {},
          controls: t.controls || {},
          selectedIndex: parseInt(t.selectedIndex) || 0,
          auto_poll: Boolean(t.auto_poll)
        }));
        window.restoredTabsFromLocalStorage = true;
      }
      if (Array.isArray(st.trendWatches) && typeof trendWatches !== 'undefined') {
        trendWatches = st.trendWatches;
      }
      if (st.trendStudioDisplayMode && typeof trendStudioDisplayMode !== 'undefined') {
        trendStudioDisplayMode = st.trendStudioDisplayMode;
      }
      if (st.trendGridCols && typeof trendGridCols !== 'undefined') {
        trendGridCols = st.trendGridCols;
      }
      if (st.trendWindowPoints && typeof trendWindowPoints !== 'undefined') {
        trendWindowPoints = parseInt(st.trendWindowPoints) || 60;
      }
      if (typeof st.trendNormalizedScale === 'boolean' && typeof trendNormalizedScale !== 'undefined') {
        trendNormalizedScale = st.trendNormalizedScale;
      }
      if (st.activeTabId && sessionTabs.some(x => x.id === st.activeTabId)) {
        activeTabId = st.activeTabId;
      } else if (sessionTabs[0]) {
        activeTabId = sessionTabs[0].id;
      }
      if (typeof sdStudioSelectedFilename !== 'undefined' && st.sdStudioSelectedFilename) {
        sdStudioSelectedFilename = st.sdStudioSelectedFilename;
      }
      if (typeof sdStudioActiveTabIdx !== 'undefined' && typeof st.sdStudioActiveTabIdx === 'number') {
        sdStudioActiveTabIdx = st.sdStudioActiveTabIdx;
      }
      if (st.activeSubTabs && typeof st.activeSubTabs === 'object') {
        activeSubTabs = { ...activeSubTabs, ...st.activeSubTabs };
      }
      if (typeof st.isHeaderDetailsOpen === 'boolean') toggleHeaderDetails(st.isHeaderDetailsOpen);
      if (typeof st.isTabExtraToolsOpen === 'boolean') toggleTabExtraTools(st.isTabExtraToolsOpen);
      if (typeof st.isPollAdvancedOpen === 'boolean') togglePollAdvancedDetails(st.isPollAdvancedOpen);
      if (typeof st.isSdHeaderToolsOpen === 'boolean') toggleSdStudioHeaderTools(st.isSdHeaderToolsOpen);
      if (typeof st.isSdInspectorAdvancedOpen === 'boolean') toggleSdInspectorAdvanced(st.isSdInspectorAdvancedOpen);
      if (typeof st.isMobileConfigCollapsed === 'boolean') {
        isMobileConfigCollapsed = !st.isMobileConfigCollapsed;
        toggleMobileConfigCollapse();
      }
      if (typeof st.isDesktopSidebarCollapsed === 'boolean') {
        isDesktopSidebarCollapsed = st.isDesktopSidebarCollapsed;
        applyDesktopSidebarState();
      }
      if (typeof st.inspectorWidthPx === 'number' && st.inspectorWidthPx >= 280 && st.inspectorWidthPx <= 680) {
        setInspectorWidthPreset(st.inspectorWidthPx, true);
      }
      if (st.currentView) {
        currentView = st.currentView;
      }
    }

    // URL hash takes priority if present (#poll, #profiles, #scanner, #trend, #gateway, #datalog, #aidoc, #system)
    const hashView = (window.location.hash || '').replace(/^#/, '').trim();
    const validViews = new Set(['poll', 'profiles', 'scanner', 'trend', 'gateway', 'datalog', 'aidoc', 'system']);
    if (validViews.has(hashView)) {
      currentView = hashView;
    }
  } catch (e) {} finally {
    isRestoringUiState = false;
  }
}

function showToast(msg) {
  const b = document.getElementById('toastBanner');
  const t = document.getElementById('toastText');
  if (!b || !t) return;
  t.textContent = msg;
  b.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => b.classList.remove('show'), 3800);
}

// ==================== PROGRESSIVE DISCLOSURE & MOBILE NAVIGATION HELPERS ====================
function toggleHeaderDetails(forceState) {
  const bar = document.getElementById('headerDetailsBar');
  const arr = document.getElementById('icoHeaderDetailsArrow');
  isHeaderDetailsOpen = (typeof forceState === 'boolean') ? forceState : !isHeaderDetailsOpen;
  if (bar) bar.classList.toggle('open', isHeaderDetailsOpen);
  if (arr) arr.textContent = isHeaderDetailsOpen ? '▴' : '▾';
  saveUiStateToStorage();
}

function toggleTabExtraTools(forceState) {
  const box = document.getElementById('tabExtraToolsBox');
  const arr = document.getElementById('icoTabToolsArrow');
  isTabExtraToolsOpen = (typeof forceState === 'boolean') ? forceState : !isTabExtraToolsOpen;
  if (box) box.classList.toggle('open', isTabExtraToolsOpen);
  if (arr) arr.textContent = isTabExtraToolsOpen ? '▴' : '▾';
  saveUiStateToStorage();
}

function togglePollAdvancedDetails(forceState) {
  const sec = document.getElementById('pollAdvancedSection');
  const arr = document.getElementById('icoPollAdvArrow');
  isPollAdvancedOpen = (typeof forceState === 'boolean') ? forceState : !isPollAdvancedOpen;
  if (sec) sec.classList.toggle('open', isPollAdvancedOpen);
  if (arr) arr.textContent = isPollAdvancedOpen ? '▴' : '▾';
  saveUiStateToStorage();
}

function toggleSdStudioHeaderTools(forceState) {
  const sec = document.getElementById('sdStudioHeaderToolsDrawer');
  const arr = document.getElementById('icoSdHeaderToolsArrow');
  isSdHeaderToolsOpen = (typeof forceState === 'boolean') ? forceState : !isSdHeaderToolsOpen;
  if (sec) sec.classList.toggle('open', isSdHeaderToolsOpen);
  if (arr) arr.textContent = isSdHeaderToolsOpen ? '▴' : '▾';
  saveUiStateToStorage();
}

function toggleSdInspectorAdvanced(forceState) {
  const sec = document.getElementById('sdInspectorAdvancedDrawer');
  const arr = document.getElementById('icoSdInspAdvArrow');
  const btn = document.getElementById('btnToggleSdInspectorAdvanced');
  isSdInspectorAdvancedOpen = (typeof forceState === 'boolean') ? forceState : !isSdInspectorAdvancedOpen;
  if (sec) sec.classList.toggle('open', isSdInspectorAdvancedOpen);
  if (arr) arr.textContent = isSdInspectorAdvancedOpen ? '▴' : '▾';
  if (btn) {
    btn.innerHTML = isSdInspectorAdvancedOpen
      ? '🔬 Thu Gọn Phân Tích Phụ <span id="icoSdInspAdvArrow">▴</span>'
      : '🔬 Mở Rộng Phân Tích Khối Lệnh, Ma Trận &amp; JSON Gốc <span id="icoSdInspAdvArrow">▾</span>';
  }
  saveUiStateToStorage();
}

function toggleQuickBuilderPresets(forceState) {
  const sec = document.getElementById('qbPresetsDrawer');
  const arr = document.getElementById('icoQbPresetsArrow');
  isQbPresetsOpen = (typeof forceState === 'boolean') ? forceState : !isQbPresetsOpen;
  if (sec) sec.classList.toggle('open', isQbPresetsOpen);
  if (arr) arr.textContent = isQbPresetsOpen ? '▴' : '▾';
}

function applyDesktopSidebarState() {
  const sb = document.querySelector('aside.sidebar');
  const btn = document.getElementById('btnToggleSidebar');
  if (!sb) return;
  if (window.innerWidth > 820) {
    sb.classList.toggle('desktop-collapsed', isDesktopSidebarCollapsed);
    if (btn) {
      btn.innerHTML = isDesktopSidebarCollapsed ? '☰ <span style="font-size:11px;font-weight:700;">Menu</span>' : '☰';
      btn.title = isDesktopSidebarCollapsed
        ? 'Hiện lại cột Menu Điều Hướng bên trái'
        : 'Thu gọn (Ẩn) cột Menu Điều Hướng bên trái để mở rộng bảng dữ liệu';
    }
  } else {
    sb.classList.remove('desktop-collapsed');
  }
}

function toggleMobileSidebar(forceState) {
  const sb = document.querySelector('aside.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (!sb) return;
  if (window.innerWidth > 820 && typeof forceState !== 'boolean') {
    isDesktopSidebarCollapsed = !isDesktopSidebarCollapsed;
    applyDesktopSidebarState();
    saveUiStateToStorage();
    return;
  }
  const nextState = (typeof forceState === 'boolean') ? forceState : !sb.classList.contains('mobile-open');
  sb.classList.toggle('mobile-open', nextState);
  if (bd) bd.classList.toggle('open', nextState);
}

function toggleMobileConfigCollapse(forceState) {
  const toolbar = document.getElementById('pollConfigToolbar');
  const advSec = document.getElementById('pollAdvancedSection');
  const btn = document.getElementById('btnMobileToggleCfg');
  if (!toolbar) return;
  isMobileConfigCollapsed = (typeof forceState === 'boolean') ? forceState : !isMobileConfigCollapsed;
  toolbar.classList.toggle('mobile-collapsed', isMobileConfigCollapsed);
  if (advSec) advSec.classList.toggle('mobile-collapsed', isMobileConfigCollapsed);
  if (btn) {
    btn.innerHTML = isMobileConfigCollapsed
      ? '⚙️ Mở Cấu Hình ▾'
      : '⚙️ Thu Gọn ▴';
  }
  saveUiStateToStorage();
}

function toggleMobileCardMode(forceCard) {
  isMobileCardView = (typeof forceCard === 'boolean') ? forceCard : !isMobileCardView;
  const gridContainer = document.getElementById('pollGridContainer');
  const btn = document.getElementById('btnToggleCardTableMode');
  if (gridContainer) {
    gridContainer.classList.toggle('force-card-view', isMobileCardView);
    gridContainer.classList.toggle('force-table-view', !isMobileCardView);
  }
  if (btn) {
    btn.innerHTML = isMobileCardView ? '📋 Xem Dạng Bảng' : '📱 Xem Thẻ Mobile';
    btn.className = isMobileCardView ? 'btn btn-primary' : 'btn btn-outline';
  }
  renderTable();
  saveUiStateToStorage();
}

// ==================== SERIAL PORT & USB RESCAN ====================
async function triggerUsbRescan(hardReset) {
  const ico = document.getElementById('icoReloadUsb');
  if (ico) ico.classList.add('spin-anim');
  try {
    const res = await fetch('/api/serial/rescan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hard_reset: Boolean(hardReset) })
    });
    const data = await res.json();
    if (data.success) {
      if (data.available_ports) {
        availablePortsCache = data.available_ports;
        refreshPortDropdowns();
      }
      if (typeof updateSystemStatus === 'function') await updateSystemStatus();
      showToast(data.message || `Đã quét USB: ${data.external_count || 0} cổng COM sẵn sàng!`);
    } else {
      alert("Lỗi quét lại USB: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi quét USB: " + e);
  } finally {
    if (ico) ico.classList.remove('spin-anim');
  }
}

let multiGwConfigs = Array.from({ length: 8 }, (_, idx) => ({
  index: idx,
  com_label: `COM ${idx + 1}`,
  port: `/dev/ttyCH${idx}`,
  tcp_port: 5001 + idx,
  baud: 9600,
  framing: "N-1"
}));

function isTcpPortString(port) {
  return Boolean(port && /^(tcp|rtuovertcp|rtu_tcp):\/\//i.test(String(port).trim()));
}

function parseTcpPortString(port) {
  const s = String(port || '').trim();
  const m = s.match(/^(tcp|rtuovertcp|rtu_tcp):\/\/([^:/\s]+)(?::(\d+))?/i);
  if (!m) {
    return { isTcp: false, proto: 'tcp', host: '192.168.10.1', tcpPort: 502, hostPort: '192.168.10.1:502' };
  }
  const rawProto = m[1].toLowerCase();
  const proto = (rawProto === 'rtuovertcp' || rawProto === 'rtu_tcp') ? 'rtuovertcp' : 'tcp';
  const host = m[2];
  const tcpPort = parseInt(m[3]) || 502;
  return {
    isTcp: true,
    proto,
    host,
    tcpPort,
    hostPort: `${host}:${tcpPort}`,
    fullEndpoint: `${proto}://${host}:${tcpPort}`
  };
}

function shortPortLabel(port) {
  if (!port) return "--";
  if (port === "ALL") return "8 CỔNG COM";
  if (isTcpPortString(port)) {
    const info = parseTcpPortString(port);
    return `${info.proto === 'rtuovertcp' ? 'RTU-TCP' : 'TCP'} ${info.hostPort}`;
  }
  if (port.startsWith("/dev/ttyCH")) {
    const idx = parseInt(port.replace("/dev/ttyCH", ""));
    if (!isNaN(idx)) return `COM ${idx + 1}`;
  }
  return port.replace("/dev/", "");
}

let sessionTabs = [
  {
    id: "tab_1",
    name: "Phiên Đo 1",
    port: "/dev/ttyCH0",
    baud: 9600,
    parity: "N",
    stopbits: 1,
    slave_id: 1,
    fn_code: 3,
    start_addr: 0,
    count: 10,
    disabled_addrs: [],
    only_tagged: false,
    format: "uint16",
    scan_ms: 1000,
    isPolling: false,
    timer: null,
    values: [],
    rawHexs: [],
    tags: {},
    units: {},
    scales: {},
    selectedIndex: 0
  }
];
let activeTabId = "tab_1";
let currentView = "poll";
let isGatewayRunning = false;
let isLoggerRunning = false;
let trendHistory = [];
let trendWatches = [];
let trendDataSeries = {};
let trendStudioDisplayMode = "both";
let trendGridCols = "auto";
let trendWindowPoints = 60;
let trendNormalizedScale = false;
let trendIsPaused = false;
let selectorsInitialized = false;

function getActiveTab() {
  return sessionTabs.find(t => t.id === activeTabId) || sessionTabs[0];
}

function initStandardSelectors() {
  document.querySelectorAll('.js-baud-select').forEach(sel => {
    const prev = parseInt(sel.value) || globalSerial.baud || 9600;
    sel.innerHTML = STANDARD_BAUDS.map(b =>
      `<option value="${b}" ${b === prev ? 'selected' : ''}>${b} bps${b === 9600 ? ' (Chuẩn)' : ''}</option>`
    ).join('');
  });
  refreshPortDropdowns();
  selectorsInitialized = true;
}

function refreshPortDropdowns() {
  const allPortSelects = [document.getElementById('selPort'), ...document.querySelectorAll('.js-port-select')];
  const extCount = availablePortsCache.filter(p => p.is_external).length;

  // Collect any active TCP endpoints from sessionTabs so they stay selectable in #selPort and #selMapPort
  const customTcpSet = new Set([
    'tcp://10.212.156.12:5000',
    'tcp://10.212.156.12:5001',
    'tcp://192.168.10.1:502',
    'tcp://127.0.0.1:5000',
    'tcp://127.0.0.1:5001',
    'rtuovertcp://10.212.156.12:5001',
    'rtuovertcp://192.168.10.1:502'
  ]);
  (sessionTabs || []).forEach(t => {
    if (t && isTcpPortString(t.port)) customTcpSet.add(t.port);
  });

  allPortSelects.forEach(sel => {
    if (!sel) return;
    const isMainPollPort = (sel.id === 'selPort');
    const isMapPort = (sel.id === 'selMapPort');
    const allowTcp = isMainPollPort || isMapPort;
    const allowAll = sel.classList.contains('js-allow-all-ports') && extCount > 1;
    const prev = sel.value;
    const validIds = new Set(availablePortsCache.map(p => p.id));
    if (allowAll) validIds.add('ALL');
    if (allowTcp) {
      customTcpSet.forEach(ep => validIds.add(ep));
      if (isTcpPortString(prev)) {
        validIds.add(prev);
        customTcpSet.add(prev);
      }
    }
    const cur = validIds.has(prev) ? prev : globalSerial.port;

    let html = '';
    if (allowAll) {
      html += `<option value="ALL" ${cur === 'ALL' ? 'selected' : ''}>⚡ TẤT CẢ ${extCount} CỔNG COM (Quét Song Song COM 1→${extCount})</option>`;
    }
    html += availablePortsCache.map(p =>
      `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${p.label}</option>`
    ).join('');

    if (allowTcp) {
      html += `<optgroup label="🌐 Kết Nối Mạng Modbus TCP / RTU-over-TCP">`;
      Array.from(customTcpSet).forEach(ep => {
        const info = parseTcpPortString(ep);
        let desc = info.proto === 'rtuovertcp'
          ? `🌐 [RTU over TCP] ${info.hostPort} (CRC16 qua TCP)`
          : `🌐 [Modbus TCP] ${info.hostPort} (MBAP Chuẩn PLC)`;
        if (info.host === '127.0.0.1' && info.tcpPort === 5000) {
          desc = `🌐 [Modbus TCP] 127.0.0.1:5000 (Smart Hub Router)`;
        } else if (info.host === '127.0.0.1' && info.tcpPort >= 5001 && info.tcpPort <= 5008) {
          desc = `🌐 [Modbus TCP] 127.0.0.1:${info.tcpPort} (Gateway COM ${info.tcpPort - 5000})`;
        }
        html += `<option value="${ep}" ${ep === cur ? 'selected' : ''}>${desc}</option>`;
      });
      html += `</optgroup>`;
    }
    sel.innerHTML = html;
  });
}

function updateHeaderSerialBadge(port, baud, parity, stopbits) {
  const p = parity || 'N';
  const s = stopbits || 1;
  const shortP = shortPortLabel(port);
  let text = '';
  if (isTcpPortString(port)) {
    const info = parseTcpPortString(port);
    text = `🌐 ${info.proto === 'rtuovertcp' ? 'RTU-TCP' : 'Modbus TCP'} • ${info.hostPort}`;
  } else if (port && port.startsWith('/dev/ttyCH')) {
    text = `${shortP} (${port.replace('/dev/', '')}) • ${baud} 8${p}${s}`;
  } else {
    text = `${port} • ${baud} 8${p}${s}`;
  }
  const el = document.getElementById('txtBadgePort');
  if (el) el.textContent = text;
  const sysEl = document.getElementById('lblSysPortExt');
  if (sysEl) sysEl.textContent = text;
}

async function pushSerialConfigToBackend(port, baud, parity, stopbits) {
  globalSerial = { port, baud, parity, stopbits };
  updateHeaderSerialBadge(port, baud, parity, stopbits);
  try {
    await fetch('/api/serial/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baud, parity, stopbits })
    });
  } catch (e) {}
}

function onToolbarSerialChange() {
  const t = getActiveTab();
  const port = document.getElementById('selPort').value;
  const baud = parseInt(document.getElementById('selBaud').value) || 9600;
  const framingParts = (document.getElementById('selFraming').value || 'N-1').split('-');
  const parity = framingParts[0] || 'N';
  const stopbits = parseInt(framingParts[1]) || 1;

  t.port = port;
  t.baud = baud;
  t.parity = parity;
  t.stopbits = stopbits;

  if (isTcpPortString(port)) {
    const info = parseTcpPortString(port);
    const protoEl = document.getElementById('selPollTcpProto');
    const hpEl = document.getElementById('inpPollTcpHostPort');
    if (protoEl) protoEl.value = info.proto;
    if (hpEl) hpEl.value = info.hostPort;
    updateHeaderSerialBadge(port, baud, parity, stopbits);
  } else {
    document.querySelectorAll('.js-port-select').forEach(s => { if (s.value !== 'ALL') s.value = port; });
    document.querySelectorAll('.js-baud-select').forEach(s => { s.value = String(baud); });
    const fVal = `${parity}-${stopbits}`;
    ['selScanRangeFraming', 'selSpecFraming', 'selGwFraming'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = fVal;
    });
    pushSerialConfigToBackend(port, baud, parity, stopbits);
  }

  renderTabs();
  saveUiStateToStorage();
}

function onToolbarTcpTargetChange() {
  const t = getActiveTab();
  if (!t) return;
  const proto = (document.getElementById('selPollTcpProto')?.value || 'tcp').trim();
  let rawHp = (document.getElementById('inpPollTcpHostPort')?.value || '192.168.10.1:502').trim();
  rawHp = rawHp.replace(/^(tcp|rtuovertcp|rtu_tcp):\/\//i, '');
  if (!rawHp.includes(':')) rawHp = `${rawHp}:502`;
  const newEndpoint = `${proto}://${rawHp}`;
  t.port = newEndpoint;
  refreshPortDropdowns();
  const selP = document.getElementById('selPort');
  if (selP) selP.value = newEndpoint;
  updateHeaderSerialBadge(t.port, t.baud, t.parity, t.stopbits);
  renderTabs();
  saveUiStateToStorage();
}

async function quickTestActiveTabTcp() {
  const t = getActiveTab();
  if (!t || !isTcpPortString(t.port)) return;
  const info = parseTcpPortString(t.port);
  showToast(`Đang Ping & Test ${info.proto.toUpperCase()} ${info.hostPort} (Unit ID ${t.slave_id})...`);
  try {
    const res = await fetch('/api/scan/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'quick_test',
        host: info.host,
        tcp_port: info.tcpPort,
        protocol: info.proto,
        unit_id: t.slave_id || 1,
        fn_code: t.fn_code || 3,
        test_addr: t.start_addr || 0,
        quantity: Math.min(10, t.count || 1),
        timeout_ms: 800
      })
    });
    const data = await res.json();
    if (data.success && data.tcp_reachable) {
      if (data.status === 'ONLINE' || data.status === 'ONLINE_EXCEPTION') {
        showToast(`✅ Kết nối ${info.hostPort} OK (${data.connect_ms}ms) • ${data.detail}`);
        if (typeof pollOnce === 'function') pollOnce();
      } else {
        showToast(`⚠️ Cổng TCP ${info.hostPort} MỞ (${data.connect_ms}ms) nhưng Unit ID ${t.slave_id} chưa trả lời: ${data.error || ''}`);
      }
    } else {
      showToast(`❌ Không kết nối được TCP ${info.hostPort}: ${data.error || 'Timeout/Refused'}`);
    }
  } catch (e) {
    showToast(`Lỗi kiểm tra TCP: ${e}`);
  }
}

function openSerialConfigModal(targetPort) {
  const p = targetPort || globalSerial.port;
  document.getElementById('modalSerialPort').value = p;
  document.getElementById('modalSerialBaud').value = String(globalSerial.baud);
  document.getElementById('modalSerialFraming').value = `${globalSerial.parity}-${globalSerial.stopbits}`;
  const aliasEl = document.getElementById('modalSerialAlias');
  if (aliasEl) aliasEl.value = portAliasesCache[p] || '';
  document.getElementById('serialConfigModal').classList.add('open');
}

function onModalPortSelectChange() {
  const p = document.getElementById('modalSerialPort').value;
  const aliasEl = document.getElementById('modalSerialAlias');
  if (aliasEl) aliasEl.value = portAliasesCache[p] || '';
}

function closeSerialConfigModal() {
  document.getElementById('serialConfigModal').classList.remove('open');
}

async function saveSerialConfigModal() {
  const port = document.getElementById('modalSerialPort').value;
  const baud = parseInt(document.getElementById('modalSerialBaud').value) || 9600;
  const parts = (document.getElementById('modalSerialFraming').value || 'N-1').split('-');
  const parity = parts[0] || 'N';
  const stopbits = parseInt(parts[1]) || 1;
  const aliasVal = (document.getElementById('modalSerialAlias').value || '').trim();

  const t = getActiveTab();
  t.port = port;
  t.baud = baud;
  t.parity = parity;
  t.stopbits = stopbits;

  try {
    const res = await fetch('/api/serial/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baud, parity, stopbits, alias: aliasVal })
    });
    const data = await res.json();
    if (data.port_aliases) portAliasesCache = data.port_aliases;
    if (data.available_ports) {
      availablePortsCache = data.available_ports;
      refreshPortDropdowns();
    }
  } catch (e) {}

  globalSerial = { port, baud, parity, stopbits };
  updateHeaderSerialBadge(port, baud, parity, stopbits);
  syncToolbarWithActiveTab();
  if (typeof initMultiGatewayMatrix === 'function') initMultiGatewayMatrix();
  document.querySelectorAll('.js-port-select').forEach(s => { if (s.value !== 'ALL') s.value = port; });
  document.querySelectorAll('.js-baud-select').forEach(s => { s.value = String(baud); });
  const fVal = `${parity}-${stopbits}`;
  ['selScanRangeFraming', 'selSpecFraming', 'selGwFraming'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = fVal;
  });

  closeSerialConfigModal();
  showToast(`Đã lưu cấu hình ${shortPortLabel(port)}${aliasVal ? ' [' + aliasVal + ']' : ''} • ${baud} 8${parity}${stopbits}`);
}

// ==================== VIEW & SUB-TAB SWITCHERS ====================
function switchView(viewId, skipHashUpdate) {
  showView(viewId, skipHashUpdate);
}
function showView(viewId, skipHashUpdate) {
  currentView = viewId || 'poll';
  toggleMobileSidebar(false);

  if (!skipHashUpdate && typeof window !== 'undefined' && window.history && window.history.replaceState) {
    window.history.replaceState(null, '', '#' + currentView);
  }
  saveUiStateToStorage();

  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const pollView = document.getElementById('view-poll');
  if (pollView) {
    if (currentView === 'poll') {
      pollView.style.display = 'flex';
    } else {
      pollView.style.display = 'none';
      const target = document.getElementById(`view-${currentView}`);
      if (target) target.classList.add('active');
    }
  }

  document.querySelectorAll('.sidebar .nav-btn').forEach(b => {
    b.classList.remove('active');
    const oc = b.getAttribute('onclick') || '';
    if (oc.includes(`'${currentView}'`)) b.classList.add('active');
  });

  document.querySelectorAll('.mobile-bottom-nav .mob-nav-item').forEach(b => {
    const targetV = b.getAttribute('data-view');
    b.classList.toggle('active', targetV === currentView);
  });

  if (currentView === 'scanner' && typeof renderScannerGrid === 'function') renderScannerGrid();
  if (currentView === 'datalog' && typeof loadSessions === 'function') loadSessions();
  if (currentView === 'trend' && typeof initTrendCanvas === 'function') initTrendCanvas();
  if (currentView === 'aidoc' && typeof renderAiTemplatePreview === 'function') renderAiTemplatePreview(0);
  if (currentView === 'profiles' && typeof loadSdProfileStudio === 'function') loadSdProfileStudio(false);
}

function switchSdInspectorTab(tabKey) {
  activeSubTabs.sdInsp = tabKey;
  ['visual', 'matrix', 'json'].forEach(k => {
    const b = document.getElementById(`btnSdInspTab_${k}`);
    const p = document.getElementById(`sdInspPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) {
      if (k === 'visual') {
        p.style.display = 'none';
      } else {
        p.classList.toggle('active', k === tabKey);
      }
    }
  });
  saveUiStateToStorage();
}

function switchScannerTab(tabKey) {
  activeSubTabs.scanner = tabKey;
  ['range', 'tcp', 'autobaud', 'special', 'regmap'].forEach(k => {
    const b = document.getElementById(`btnScanTab_${k}`);
    const p = document.getElementById(`scanPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  const shared = document.getElementById('sharedDeviceScanResults');
  if (shared) shared.style.display = (tabKey === 'regmap') ? 'none' : 'block';
  if (typeof renderScannerGrid === 'function' && (tabKey === 'range' || tabKey === 'tcp')) {
    renderScannerGrid();
  }
  saveUiStateToStorage();
}

function switchGatewayTab(tabKey) {
  activeSubTabs.gateway = tabKey;
  ['multi', 'smart', 'com2com', 'ctrl', 'net'].forEach(k => {
    const b = document.getElementById(`btnGwTab_${k}`);
    const p = document.getElementById(`gwPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  saveUiStateToStorage();
}

function switchAiDocTab(tabKey) {
  activeSubTabs.aidoc = tabKey;
  ['schema', 'templates', 'prompt', 'api'].forEach(k => {
    const b = document.getElementById(`btnAiTab_${k}`);
    const p = document.getElementById(`aiPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  if (tabKey === 'templates' && typeof renderAiTemplatePreview === 'function') renderAiTemplatePreview(0);
  saveUiStateToStorage();
}

function switchDatalogTab(tabKey) {
  activeSubTabs.datalog = tabKey;
  ['cfg', 'files'].forEach(k => {
    const b = document.getElementById(`btnLogTab_${k}`);
    const p = document.getElementById(`logPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  if (tabKey === 'files' && typeof loadSessions === 'function') loadSessions();
  saveUiStateToStorage();
}

// ==================== SMART ADDRESS SKIPPING & SUB-BLOCK HELPERS ====================
function parseAddrRangeSet(spec) {
  const out = new Set();
  if (!spec && spec !== 0) return out;
  if (Array.isArray(spec)) {
    spec.forEach(item => {
      parseAddrRangeSet(String(item)).forEach(v => out.add(v));
    });
    return out;
  }
  const text = String(spec).replace(/;/g, ',');
  text.split(',').forEach(part => {
    const p = part.trim();
    if (!p) return;
    const mRange = p.match(/^(\d+)\s*(?:\.\.|-|:|~)\s*(\d+)$/);
    if (mRange) {
      let a = parseInt(mRange[1]), b = parseInt(mRange[2]);
      if (a > b) { const tmp = a; a = b; b = tmp; }
      for (let x = a; x <= Math.min(b, a + 1000); x++) out.add(x);
    } else if (/^\d+$/.test(p)) {
      out.add(parseInt(p));
    }
  });
  return out;
}

function formatAddrRangeString(addrSetOrArr) {
  const arr = Array.from(addrSetOrArr || []).map(x => parseInt(x)).filter(x => !isNaN(x) && x >= 0);
  const sorted = Array.from(new Set(arr)).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const ranges = [];
  let rStart = sorted[0], rPrev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i];
    if (a === rPrev + 1) {
      rPrev = a;
    } else {
      ranges.push(rStart === rPrev ? `${rStart}` : `${rStart}-${rPrev}`);
      rStart = a;
      rPrev = a;
    }
  }
  ranges.push(rStart === rPrev ? `${rStart}` : `${rStart}-${rPrev}`);
  return ranges.join(", ");
}

const formatAddrRangeSet = formatAddrRangeString;

function isMapAddressKeyed(mapObj, startAddr) {
  if (!mapObj || typeof mapObj !== 'object') return false;
  if (startAddr <= 0) return false;
  const keys = Object.keys(mapObj).map(k => parseInt(k)).filter(k => !isNaN(k));
  if (keys.length === 0) return false;
  if (Object.prototype.hasOwnProperty.call(mapObj, "0")) return false;
  return keys.every(k => k >= startAddr);
}

const isTagMapAddressKeyed = isMapAddressKeyed;

function getPointMeta(mapObj, idx, startAddr, defaultVal) {
  if (!mapObj || typeof mapObj !== 'object') return defaultVal;
  const addrDec = startAddr + idx;
  if (mapObj[`@${addrDec}`] !== undefined) return mapObj[`@${addrDec}`];
  if (isMapAddressKeyed(mapObj, startAddr)) {
    if (mapObj[String(addrDec)] !== undefined) return mapObj[String(addrDec)];
    if (mapObj[addrDec] !== undefined) return mapObj[addrDec];
  }
  if (mapObj[String(idx)] !== undefined) return mapObj[String(idx)];
  if (mapObj[idx] !== undefined) return mapObj[idx];
  if (mapObj[String(addrDec)] !== undefined) return mapObj[String(addrDec)];
  return defaultVal;
}

function setPointMeta(mapObj, idx, startAddr, val) {
  if (!mapObj) return;
  const addrDec = startAddr + idx;
  if (isMapAddressKeyed(mapObj, startAddr)) {
    mapObj[String(addrDec)] = val;
  } else {
    mapObj[String(idx)] = val;
  }
}

function isRegisterDisabled(tab, idx) {
  const addrDec = tab.start_addr + idx;
  const disSet = parseAddrRangeSet(tab.disabled_addrs);
  if (disSet.has(addrDec)) return true;
  if (tab.only_tagged) {
    const tagVal = getPointMeta(tab.tags, idx, tab.start_addr, "");
    if (!tagVal || !String(tagVal).trim()) return true;
  }
  return false;
}

function getEffectiveDisabledSet(tab) {
  const s = parseAddrRangeSet(tab.disabled_addrs);
  if (tab.only_tagged) {
    for (let i = 0; i < (tab.count || 10); i++) {
      const tg = getPointMeta(tab.tags, i, tab.start_addr || 0, "");
      if (!tg || !String(tg).trim()) s.add((tab.start_addr || 0) + i);
    }
  }
  return s;
}

function computeClientSubBlocks(tab, maxChunk = 120) {
  const blocks = [];
  let curStart = null, curOff = null, curLen = 0;
  let enabledTotal = 0, skippedTotal = 0;
  for (let i = 0; i < tab.count; i++) {
    const addr = tab.start_addr + i;
    if (isRegisterDisabled(tab, i)) {
      skippedTotal++;
      if (curStart !== null) {
        blocks.push({ offset: curOff, start_addr: curStart, count: curLen });
        curStart = null; curOff = null; curLen = 0;
      }
    } else {
      enabledTotal++;
      if (curStart === null) {
        curStart = addr; curOff = i; curLen = 1;
      } else if (curLen >= maxChunk) {
        blocks.push({ offset: curOff, start_addr: curStart, count: curLen });
        curStart = addr; curOff = i; curLen = 1;
      } else {
        curLen++;
      }
    }
  }
  if (curStart !== null) {
    blocks.push({ offset: curOff, start_addr: curStart, count: curLen });
  }
  return { blocks, enabledTotal, skippedTotal };
}

function computeLocalSubBlocks(tab) {
  return computeClientSubBlocks(tab).blocks;
}

function toggleAddrDisabled(addrDec, ev) {
  if (ev) ev.stopPropagation();
  const t = getActiveTab();
  pushInspectorUndoSnapshot(t, "Đổi trạng thái Đọc/Cấm đọc");
  const disSet = parseAddrRangeSet(t.disabled_addrs);
  if (disSet.has(addrDec)) {
    disSet.delete(addrDec);
  } else {
    disSet.add(addrDec);
  }
  t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  saveUiStateToStorage();
}

function toggleInspectorPointDisabled() {
  const t = getActiveTab();
  const idx = t.selectedIndex || 0;
  toggleAddrDisabled(t.start_addr + idx);
}

function toggleInspectorPointWriteLock() {
  const t = getActiveTab();
  if (!t) return;
  toggleRegisterWriteLock(t.selectedIndex || 0);
}

function onDisabledAddrsInputChange(val) {
  const t = getActiveTab();
  const disSet = parseAddrRangeSet(val);
  t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
}

function toggleOnlyTaggedMode(checked) {
  const t = getActiveTab();
  t.only_tagged = Boolean(checked);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
}

function disableUntaggedInActiveTab() {
  const t = getActiveTab();
  const disSet = parseAddrRangeSet(t.disabled_addrs);
  let added = 0;
  for (let i = 0; i < t.count; i++) {
    const tagVal = getPointMeta(t.tags, i, t.start_addr, "");
    if (!tagVal || !String(tagVal).trim()) {
      const addr = t.start_addr + i;
      if (!disSet.has(addr)) {
        disSet.add(addr);
        added++;
      }
    }
  }
  t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  showToast(`Đã khóa ${added} thanh ghi không có tên Tag (Tổng né: ${t.disabled_addrs.length} thanh ghi)!`);
}

function enableAllInActiveTab() {
  const t = getActiveTab();
  t.disabled_addrs = [];
  t.only_tagged = false;
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  showToast("Đã bật đọc lại toàn bộ thanh ghi trong Tab này.");
}

async function autoMaskForbiddenRegisters() {
  const t = getActiveTab();
  const btn = document.getElementById('btnAutoMaskExc');
  const origHtml = btn ? btn.innerHTML : '🔍 Tự Dò Ô Cấm';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="pulse-dot"></span> Đang Dò...';
  }
  try {
    const res = await fetch('/api/poll/auto_mask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: t.port,
        baud: t.baud,
        parity: t.parity || 'N',
        stopbits: t.stopbits || 1,
        slave_id: t.slave_id,
        fn_code: t.fn_code,
        start_addr: t.start_addr,
        count: t.count,
        timeout_ms: 150
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.valid_count === 0 && (data.disabled_addrs || []).length === 0) {
        showToast(data.message || "Thiết bị chưa phản hồi (Timeout) — bạn có thể nhập tay hoặc nhấn '🚫 Khóa Ô Trống Tag'.");
      } else {
        const merged = new Set([...parseAddrRangeSet(t.disabled_addrs), ...(data.disabled_addrs || [])]);
        t.disabled_addrs = Array.from(merged).sort((a, b) => a - b);
        syncToolbarWithActiveTab();
        renderTable();
        updateInspector();
        showToast(data.message || `Đã tự động khóa ${t.disabled_addrs.length} thanh ghi cấm đọc!`);
      }
    } else {
      alert("Lỗi dò thanh ghi cấm: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi dò thanh ghi cấm: " + e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

function mergeSameSlaveTabs() {
  const cur = getActiveTab();
  const sameGroup = sessionTabs.filter(t =>
    t.port === cur.port &&
    t.slave_id === cur.slave_id &&
    t.fn_code === cur.fn_code
  );
  if (sameGroup.length <= 1) {
    alert(`Hiện chỉ có 1 Tab trên ${shortPortLabel(cur.port)} • Slave ID ${cur.slave_id} • FC0${cur.fn_code}.\nTính năng này dùng khi bạn đang có nhiều Tab rời rạc của cùng 1 thiết bị (ví dụ G1..G11) và muốn gộp thành 1 bảng duy nhất có tự động khóa các thanh ghi trống ở giữa!`);
    return;
  }

  const sorted = [...sameGroup].sort((a, b) => a.start_addr - b.start_addr);
  const clusters = [];
  let curCluster = [sorted[0]];
  let clusterMin = sorted[0].start_addr;

  for (let i = 1; i < sorted.length; i++) {
    const candidateEnd = sorted[i].start_addr + sorted[i].count - 1;
    if (candidateEnd - clusterMin + 1 <= 250) {
      curCluster.push(sorted[i]);
    } else {
      clusters.push(curCluster);
      curCluster = [sorted[i]];
      clusterMin = sorted[i].start_addr;
    }
  }
  clusters.push(curCluster);

  const mergedTabs = clusters.map((grp, cIdx) => {
    const minAddr = Math.min(...grp.map(x => x.start_addr));
    const maxAddr = Math.max(...grp.map(x => x.start_addr + x.count - 1));
    const totalCount = maxAddr - minAddr + 1;
    const enabledSet = new Set();
    const newTags = {}, newUnits = {}, newScales = {};

    grp.forEach(tab => {
      const tabDis = parseAddrRangeSet(tab.disabled_addrs);
      for (let i = 0; i < tab.count; i++) {
        const addr = tab.start_addr + i;
        const newOff = addr - minAddr;
        if (!tabDis.has(addr)) enabledSet.add(addr);
        const tg = getPointMeta(tab.tags, i, tab.start_addr, undefined);
        const un = getPointMeta(tab.units, i, tab.start_addr, undefined);
        const sc = getPointMeta(tab.scales, i, tab.start_addr, undefined);
        if (tg !== undefined && tg !== "") newTags[String(newOff)] = tg;
        if (un !== undefined && un !== "") newUnits[String(newOff)] = un;
        if (sc !== undefined && sc !== 1.0) newScales[String(newOff)] = sc;
      }
    });

    const disabledList = [];
    for (let a = minAddr; a <= maxAddr; a++) {
      if (!enabledSet.has(a)) disabledList.push(a);
    }

    const first = grp[0];
    return {
      id: `tab_merged_${Date.now()}_${cIdx}`,
      name: grp.length > 1 ? `${first.name.split(' ')[0]} (Gộp ${minAddr}..${maxAddr})` : first.name,
      port: first.port,
      baud: first.baud,
      parity: first.parity || 'N',
      stopbits: first.stopbits || 1,
      slave_id: first.slave_id,
      fn_code: first.fn_code,
      start_addr: minAddr,
      count: totalCount,
      disabled_addrs: disabledList,
      only_tagged: false,
      format: first.format || 'uint16',
      scan_ms: first.scan_ms || 1000,
      isPolling: false,
      timer: null,
      values: [],
      rawHexs: [],
      lastPollState: 'idle',
      lastError: '',
      blockErrors: [],
      tags: newTags,
      units: newUnits,
      scales: newScales,
      selectedIndex: 0
    };
  });

  const removeIds = new Set(sameGroup.map(x => x.id));
  sameGroup.forEach(t => { if (t.timer) clearInterval(t.timer); });
  const firstIdx = sessionTabs.findIndex(t => removeIds.has(t.id));
  const remaining = sessionTabs.filter(t => !removeIds.has(t.id));
  remaining.splice(Math.max(0, firstIdx), 0, ...mergedTabs);
  sessionTabs = remaining;
  activeTabId = mergedTabs[0].id;
  renderTabs();
  showToast(`Đã gộp ${sameGroup.length} Tab thành ${mergedTabs.length} Tab thông minh (tự động khóa các thanh ghi trống ở giữa)!`);
}

// ==================== TAB SYSTEM ====================
function renderTabs(skipTableRebuild) {
  const scrollBox = document.getElementById('tabListScroll');
  const addBtn = document.getElementById('btnAddSessionTab');
  if (!scrollBox || !addBtn) return;
  scrollBox.querySelectorAll('.tab-sheet').forEach(t => t.remove());

  sessionTabs.forEach(t => {
    const div = document.createElement('div');
    div.className = `tab-sheet ${t.id === activeTabId ? 'active' : ''}`;
    const pTag = shortPortLabel(t.port);
    const disCount = parseAddrRangeSet(t.disabled_addrs).size;
    const skipBadge = disCount > 0 ? `<span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(245,158,11,0.18); color: var(--amber);" title="Đang khóa ${disCount} thanh ghi cấm đọc">🚫${disCount}</span>` : '';
    div.innerHTML = `
      <span style="font-weight: 700; color: ${t.isPolling ? 'var(--emerald)' : 'inherit'};">●</span>
      <span style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(6,182,212,0.14); color: var(--cyan); font-family: monospace;">${pTag}</span>
      <span class="tab-title" title="${t.name} (Addr ${t.start_addr}..${t.start_addr + t.count - 1})">${t.name}</span>
      ${skipBadge}
      ${sessionTabs.length > 1 ? `<span class="tab-close" onclick="closeSessionTab('${t.id}', event)">✕</span>` : ''}
    `;
    div.onclick = () => selectSessionTab(t.id);
    div.ondblclick = () => renameSessionTab(t.id);
    scrollBox.insertBefore(div, addBtn);
  });
  const anyPolling = sessionTabs.some(x => x.isPolling);
  const allBtn = document.getElementById('btnPollAllTabs');
  if (allBtn) {
    allBtn.textContent = anyPolling ? '⏹ Dừng Tất Cả' : '▶ Chạy Tất Cả';
    allBtn.style.color = anyPolling ? 'var(--rose)' : 'var(--cyan)';
  }
  syncToolbarWithActiveTab();
  if (!skipTableRebuild) {
    renderTable();
  }
  updateInspector();
}

function selectSessionTab(tabId) {
  const gridBox = document.getElementById('pollGridContainer');
  const prevTab = getActiveTab();
  if (prevTab && gridBox) {
    prevTab._scrollTop = gridBox.scrollTop;
  }
  activeTabId = tabId;
  renderTabs();
  const t = getActiveTab();
  if (t && gridBox) {
    gridBox.scrollTop = t._scrollTop || 0;
  }
  updateHeaderSerialBadge(t.port, t.baud, t.parity || 'N', t.stopbits || 1);
  saveUiStateToStorage();
}

function duplicateActiveSessionTab() {
  const src = getActiveTab();
  if (!src) return;
  const newId = `tab_${Date.now()}`;
  const clone = {
    id: newId,
    name: `${src.name} (Bản sao)`,
    port: src.port,
    baud: src.baud,
    parity: src.parity || "N",
    stopbits: src.stopbits || 1,
    slave_id: src.slave_id,
    fn_code: src.fn_code,
    start_addr: src.start_addr,
    count: src.count,
    disabled_addrs: Array.isArray(src.disabled_addrs) ? [...src.disabled_addrs] : Array.from(parseAddrRangeSet(src.disabled_addrs)),
    only_tagged: Boolean(src.only_tagged),
    format: src.format || "uint16",
    scan_ms: src.scan_ms || 1000,
    isPolling: false,
    timer: null,
    values: [],
    rawHexs: [],
    lastPollState: "idle",
    lastError: "",
    blockErrors: [],
    tags: { ...(src.tags || {}) },
    units: { ...(src.units || {}) },
    scales: { ...(src.scales || {}) },
    selectedIndex: 0
  };
  const idx = sessionTabs.findIndex(t => t.id === src.id);
  sessionTabs.splice(idx >= 0 ? idx + 1 : sessionTabs.length, 0, clone);
  activeTabId = newId;
  renderTabs();
  saveUiStateToStorage();
  showToast(`Đã nhân bản Tab '${src.name}'!`);
}

function addNewSessionTab() {
  const newId = `tab_${Date.now()}`;
  sessionTabs.push({
    id: newId,
    name: `Phiên Đo ${sessionTabs.length + 1}`,
    port: globalSerial.port,
    baud: globalSerial.baud,
    parity: globalSerial.parity,
    stopbits: globalSerial.stopbits,
    slave_id: 1,
    fn_code: 3,
    start_addr: 0,
    count: 10,
    disabled_addrs: [],
    only_tagged: false,
    format: "uint16",
    scan_ms: 1000,
    isPolling: false,
    timer: null,
    values: [],
    rawHexs: [],
    lastPollState: "idle",
    lastError: "",
    blockErrors: [],
    tags: {},
    units: {},
    scales: {},
    selectedIndex: 0
  });
  activeTabId = newId;
  renderTabs();
  saveUiStateToStorage();
}

function closeSessionTab(tabId, ev) {
  ev.stopPropagation();
  const tab = sessionTabs.find(t => t.id === tabId);
  if (tab && tab.isPolling) {
    clearInterval(tab.timer);
  }
  sessionTabs = sessionTabs.filter(t => t.id !== tabId);
  if (activeTabId === tabId) {
    activeTabId = sessionTabs[0].id;
  }
  renderTabs();
  saveUiStateToStorage();
}

function renameSessionTab(tabId) {
  const tab = sessionTabs.find(t => t.id === tabId);
  if (!tab) return;
  const newName = prompt("Nhập tên phiên đo mới:", tab.name);
  if (newName && newName.trim()) {
    tab.name = newName.trim();
    renderTabs();
    saveUiStateToStorage();
  }
}

function syncToolbarWithActiveTab() {
  const t = getActiveTab();
  if (!t) return;
  const isTcp = isTcpPortString(t.port);
  if (isTcp) {
    refreshPortDropdowns();
  }
  const selP = document.getElementById('selPort');
  if (selP) selP.value = t.port;

  const boxTcp = document.getElementById('boxPollTcpTarget');
  const boxBaud = document.getElementById('boxPollBaudField');
  if (boxTcp) boxTcp.style.display = isTcp ? 'flex' : 'none';
  if (boxBaud) boxBaud.style.display = isTcp ? 'none' : 'flex';
  if (isTcp) {
    const info = parseTcpPortString(t.port);
    const protoEl = document.getElementById('selPollTcpProto');
    const hpEl = document.getElementById('inpPollTcpHostPort');
    if (protoEl) protoEl.value = info.proto;
    if (hpEl && document.activeElement !== hpEl) hpEl.value = info.hostPort;
  }

  const selB = document.getElementById('selBaud');
  if (selB) selB.value = String(t.baud);
  const frEl = document.getElementById('selFraming');
  if (frEl) frEl.value = `${t.parity || 'N'}-${t.stopbits || 1}`;
  const inpS = document.getElementById('inpSlave');
  if (inpS) inpS.value = t.slave_id;
  const selFn = document.getElementById('selFn');
  if (selFn) selFn.value = t.fn_code;
  const inpSA = document.getElementById('inpStartAddr');
  if (inpSA) inpSA.value = t.start_addr;
  const inpC = document.getElementById('inpCount');
  if (inpC) inpC.value = t.count;
  const selFmt = document.getElementById('selFormat');
  if (selFmt) selFmt.value = t.format;
  const selSR = document.getElementById('selScanRate');
  if (selSR) selSR.value = t.scan_ms;

  const disInput = document.getElementById('inpDisabledAddrs');
  if (disInput && document.activeElement !== disInput) {
    disInput.value = formatAddrRangeString(parseAddrRangeSet(t.disabled_addrs));
  }
  const roInput = document.getElementById('inpReadOnlyAddrs');
  if (roInput && document.activeElement !== roInput) {
    roInput.value = formatAddrRangeString(parseAddrRangeSet(t.read_only_addrs));
  }
  const chkOnly = document.getElementById('chkOnlyTagged');
  if (chkOnly) chkOnly.checked = Boolean(t.only_tagged);

  const subInfo = computeClientSubBlocks(t);
  const badgeSub = document.getElementById('badgeSubBlocksInfo');
  if (badgeSub) {
    const rangeDesc = subInfo.blocks.map(b => b.count === 1 ? `${b.start_addr}` : `${b.start_addr}..${b.start_addr + b.count - 1}`).join(', ');
    badgeSub.className = subInfo.skippedTotal > 0 ? 'badge badge-amber' : 'badge badge-cyan';
    badgeSub.textContent = subInfo.skippedTotal > 0
      ? `📦 ${subInfo.blocks.length} khối lệnh • Đọc ${subInfo.enabledTotal}/${t.count} ô (Né ${subInfo.skippedTotal} ô cấm)`
      : `📦 ${subInfo.blocks.length} khối lệnh (${t.count} thanh ghi liên tiếp)`;
    badgeSub.title = `Các khối lệnh thực tế gửi xuống ${isTcp ? 'Modbus TCP' : 'RS485'}: [${rangeDesc || 'Không có'}]`;
  }

  const advBadge = document.getElementById('badgePollAdvSummary');
  if (advBadge) {
    advBadge.className = subInfo.skippedTotal > 0 ? 'badge badge-amber' : 'badge badge-cyan';
    advBadge.textContent = subInfo.skippedTotal > 0
      ? `${subInfo.blocks.length} khối • Né ${subInfo.skippedTotal}`
      : `${subInfo.blocks.length} khối`;
  }

  // Mobile quick summary badge
  const mobSum = document.getElementById('lblMobileQuickTabSummary');
  if (mobSum) {
    mobSum.textContent = isTcp
      ? `🌐 ${shortPortLabel(t.port)} • Unit:${t.slave_id} • Addr:${t.start_addr}..${t.start_addr + t.count - 1}`
      : `${shortPortLabel(t.port)} • ${t.baud} 8${t.parity || 'N'}${t.stopbits || 1} • ID:${t.slave_id} • Addr:${t.start_addr}..${t.start_addr + t.count - 1}`;
  }

  const mobPollBtn = document.getElementById('btnMobileQuickPoll');
  if (mobPollBtn) {
    mobPollBtn.className = t.isPolling ? "btn btn-rose" : "btn btn-emerald";
    mobPollBtn.textContent = t.isPolling ? "⏹ Dừng" : "▶ Chạy";
  }

  const pollBtn = document.getElementById('btnPollToggle');
  if (pollBtn) {
    if (t.isPolling) {
      pollBtn.className = "btn btn-rose";
      pollBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <span>Dừng Polling</span>
      `;
    } else {
      pollBtn.className = "btn btn-emerald";
      pollBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Bắt Đầu Polling</span>
      `;
    }
  }
}

function updateActiveTabCfg(key, val) {
  const t = getActiveTab();
  t[key] = val;
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  saveUiStateToStorage();
}

// ==================== DATA FORMATTERS ====================
function formatValue(raw, format, scale) {
  if (raw === undefined || raw === null) return "--";
  const numScale = (scale !== undefined && scale !== null && scale !== "" && isFinite(Number(scale))) ? Number(scale) : 1.0;
  const s = (typeof raw === 'number') ? raw : parseInt(raw);
  if (isNaN(s)) return "--";
  const hasDecimals = Math.abs(numScale - 1.0) > 1e-9;

  switch (format) {
    case "int16": {
      const v = s > 32767 ? s - 65536 : s;
      return (v * numScale).toFixed(hasDecimals ? 2 : 0);
    }
    case "hex":
      return "0x" + (s & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    case "binary":
      return (s & 0xFFFF).toString(2).padStart(16, "0").replace(/(\d{4})/g, "$1 ").trim();
    case "float_abcd":
    case "float_cdab":
      return (s * numScale).toFixed(2);
    case "uint16":
    default:
      return (s * numScale).toFixed(hasDecimals ? 2 : 0);
  }
}

// ==================== SMART STATE DECODER & INLINE QUICK CONTROLS ====================
function escapeHtmlStr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMultistateOptionsSpec(spec) {
  if (!spec) return [];
  if (Array.isArray(spec)) {
    return spec
      .map(o => ({
        value: typeof o.value === 'number' ? o.value : parseInt(String(o.value), String(o.value).startsWith('0x') ? 16 : 10),
        label: String(o.label ?? o.value ?? '')
      }))
      .filter(o => !isNaN(o.value));
  }
  const out = [];
  const str = String(spec).trim();
  if (!str) return out;
  str.split(/[,;|]+/).forEach(part => {
    const p = part.trim();
    if (!p || /^bit\d/i.test(p)) return;
    const m = p.match(/(?:^|\s)(0x[0-9a-fA-F]+|-?\d+)\s*(?:=|:)\s*(.+)$/);
    if (m) {
      const v = m[1].toLowerCase().startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
      const lbl = m[2].trim();
      if (!isNaN(v) && lbl) out.push({ value: v, label: lbl });
    }
  });
  return out;
}

function formatMultistateOptionsSpec(options) {
  if (!Array.isArray(options) || options.length === 0) return "";
  return options.map(o => `${o.value}=${o.label}`).join(", ");
}

// Smart detection for telemetry / system status registers that are Read-Only by nature
function isTagAutoReadOnly(tagName) {
  const tag = String(tagName || '').trim();
  if (!tag) return false;
  if (/WRITE|CLEAR|RESET|CMD|SETPOINT|PULSE|CYCLE|PWM|DUTY|FREQ_SET|_MODE|_BAUD|_PARITY|SLAVE_ID|RELAY_BITMAP|OUT12V_BITMAP/i.test(tag)) {
    return false;
  }
  if (/^(RL\d+|OUT12V_\d+|RELAY\d*|DO\d+|COIL\d*)\b/i.test(tag)) {
    return false;
  }
  if (/(^|[^A-Z0-9])(DEVICE_ID|FW_VERSION|HW_VERSION|UPTIME|REBOOT_COUNT|DIP_STATE|DI_BITMAP|DO_BITMAP|UID_WORD|NTC_TEMP|AI\d+_|MCU_VDDA|MCU_TEMP|DI\d+_STATE|DI\d+_FREQ|DI\d+_CNT|ERR_CNT|OK_CNT|SERIAL_NO|STATUS_WORD)/i.test(tag)) {
    return true;
  }
  return false;
}

function isRegisterReadOnly(tab, idx) {
  if (!tab) return false;
  if (tab.fn_code === 2 || tab.fn_code === 4) return true;
  const addrDec = tab.start_addr + idx;
  const roSet = parseAddrRangeSet(tab.read_only_addrs);
  if (roSet.has(addrDec)) return true;

  const explicit = tab.controls ? getPointMeta(tab.controls, idx, tab.start_addr, null) : null;
  if (explicit && typeof explicit === 'object' && explicit.type && explicit.type !== 'auto') {
    if (explicit.type === 'readonly' || explicit.type === 'none') return true;
    return false;
  }

  const rwSet = parseAddrRangeSet(tab.writable_addrs);
  if (rwSet.has(addrDec)) return false;

  const rawTag = getPointMeta(tab.tags, idx, tab.start_addr, "");
  return isTagAutoReadOnly(rawTag);
}

function toggleRegisterWriteLock(idx, ev) {
  if (ev) ev.stopPropagation();
  const t = getActiveTab();
  if (!t) return;
  pushInspectorUndoSnapshot(t, "Đổi khóa ghi mềm");
  const addrDec = t.start_addr + idx;
  const currentlyRo = isRegisterReadOnly(t, idx);
  const roSet = parseAddrRangeSet(t.read_only_addrs);
  const rwSet = parseAddrRangeSet(t.writable_addrs);
  if (!t.controls) t.controls = {};

  if (currentlyRo) {
    roSet.delete(addrDec);
    rwSet.add(addrDec);
    const exp = getPointMeta(t.controls, idx, t.start_addr, null);
    if (exp && (exp.type === 'readonly' || exp.type === 'none')) {
      setPointMeta(t.controls, idx, t.start_addr, undefined);
    }
    showToast(`🔓 Đã mở khóa cho phép Ghi tại địa chỉ ${addrDec}!`);
  } else {
    roSet.add(addrDec);
    rwSet.delete(addrDec);
    setPointMeta(t.controls, idx, t.start_addr, { type: 'readonly' });
    showToast(`🔒 Đã bật Cấm Ghi Mềm (Chỉ Đọc) cho địa chỉ ${addrDec}!`);
  }
  t.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
  t.writable_addrs = Array.from(rwSet).sort((a, b) => a - b);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
}

function toggleSelectedPointWriteLock() {
  const t = getActiveTab();
  if (!t) return;
  toggleRegisterWriteLock(t.selectedIndex || 0);
}

function onReadOnlyAddrsInput(val) {
  const t = getActiveTab();
  if (!t) return;
  const roSet = parseAddrRangeSet(val);
  t.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
}

function autoLockSystemReadOnlyAddrs() {
  const t = getActiveTab();
  if (!t) return;
  const roSet = parseAddrRangeSet(t.read_only_addrs);
  let lockedCount = 0;
  for (let i = 0; i < t.count; i++) {
    const rawTag = getPointMeta(t.tags, i, t.start_addr, "");
    if (isTagAutoReadOnly(rawTag)) {
      roSet.add(t.start_addr + i);
      lockedCount++;
    }
  }
  t.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
  t.writable_addrs = [];
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
  showToast(`🔒 Đã tự động khóa ghi mềm ${lockedCount} thanh ghi đo lường & hệ thống!`);
}

function unlockAllReadOnlyAddrs() {
  const t = getActiveTab();
  if (!t) return;
  t.read_only_addrs = [];
  const rwSet = new Set();
  for (let i = 0; i < t.count; i++) rwSet.add(t.start_addr + i);
  t.writable_addrs = Array.from(rwSet);
  if (t.controls) {
    Object.keys(t.controls).forEach(k => {
      if (t.controls[k] && t.controls[k].type === 'readonly') delete t.controls[k];
    });
  }
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
  showToast("🔓 Đã mở khóa cho phép ghi toàn bộ thanh ghi trong Tab này.");
}

function inferControlFromTagAndFn(tagName, fnCode) {
  const tag = String(tagName || '').trim();
  if (fnCode === 2 || fnCode === 4) {
    return { type: 'readonly', isAuto: true };
  }
  if (fnCode === 1) {
    return { type: 'toggle', onValue: 1, offValue: 0, isAuto: true };
  }
  if (isTagAutoReadOnly(tag)) {
    return { type: 'readonly', isAuto: true };
  }
  const parenMatch = tag.match(/\(([^)]*(?:0x[0-9a-fA-F]+|\d+)\s*=\s*[^)]+)\)/);
  if (parenMatch) {
    const opts = parseMultistateOptionsSpec(parenMatch[1]);
    if (opts.length >= 2) {
      if (fnCode === 3) {
        return {
          type: opts.length <= 5 ? 'buttons' : 'dropdown',
          options: opts,
          isAuto: true
        };
      }
      return { type: 'readonly', options: opts, isAuto: true };
    }
  }
  if (/WRITE\s*0\s*(TO\s*)?(RESET|CLEAR)/i.test(tag)) {
    return {
      type: 'buttons',
      options: [{ value: 0, label: '↺ Reset (0)' }],
      isAuto: true
    };
  }
  if (/WRITE\s*1\s*CLEAR|CLEAR_ALL|RESET_ERR/i.test(tag)) {
    return {
      type: 'buttons',
      options: [{ value: 1, label: '⚡ Ghi 1 (Clear)' }],
      isAuto: true
    };
  }
  if (/RELAY_BITMAP/i.test(tag)) {
    return {
      type: 'buttons',
      options: [
        { value: 0, label: 'Tắt Hết (0)' },
        { value: 15, label: 'Bật Cả 4 (15)' }
      ],
      isAuto: true
    };
  }
  if (/OUT12V_BITMAP/i.test(tag)) {
    return {
      type: 'buttons',
      options: [
        { value: 0, label: 'Tắt Hết (0)' },
        { value: 7, label: 'Bật Cả 3 (7)' }
      ],
      isAuto: true
    };
  }
  if (/(PULSE|CYCLE).*100MS/i.test(tag)) {
    return {
      type: 'buttons',
      options: [
        { value: 5, label: '⚡ 0.5s' },
        { value: 10, label: '⚡ 1s' },
        { value: 30, label: '⚡ 3s' }
      ],
      isAuto: true
    };
  }
  if (fnCode === 3 && tag) {
    if (/(^|_)(RL\d+|OUT12V_\d+|RELAY\d*|DO\d+|COIL\d*)(_STATE|_CMD|_ON|_EN)?\b/i.test(tag)) {
      return { type: 'toggle', onValue: 1, offValue: 0, isAuto: true };
    }
    if (/(PWM|DUTY|FREQ_SET|SETPOINT|SLAVE_ID|BAUD|TIMEOUT|PULSE)/i.test(tag)) {
      const isDuty = /DUTY|PWM|PULSE/i.test(tag);
      return { type: 'stepper', step: isDuty ? 10 : 1, min: 0, max: 65535, isAuto: true };
    }
  }
  return { type: 'stepper', step: 1, min: 0, max: 65535, isAuto: true };
}

function getEffectiveControlConfig(tab, idx) {
  if (!tab) return { type: 'readonly' };
  if (!tab.controls) tab.controls = {};
  const explicit = getPointMeta(tab.controls, idx, tab.start_addr, null);
  const rawTag = getPointMeta(tab.tags, idx, tab.start_addr, "");
  const inferred = inferControlFromTagAndFn(rawTag, tab.fn_code);

  if (isRegisterReadOnly(tab, idx)) {
    return { type: 'readonly', options: (explicit && explicit.options) || inferred.options };
  }

  if (explicit && typeof explicit === 'object' && explicit.type && explicit.type !== 'auto') {
    if (explicit.type === 'buttons' || explicit.type === 'dropdown') {
      const opts = parseMultistateOptionsSpec(explicit.options);
      return {
        type: explicit.type,
        options: opts.length > 0 ? opts : (inferred.options || [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }])
      };
    }
    if (explicit.type === 'toggle') {
      return {
        type: 'toggle',
        onValue: explicit.onValue !== undefined ? Number(explicit.onValue) : 1,
        offValue: explicit.offValue !== undefined ? Number(explicit.offValue) : 0
      };
    }
    if (explicit.type === 'stepper') {
      return {
        type: 'stepper',
        step: explicit.step !== undefined ? Number(explicit.step) : 1,
        min: explicit.min !== undefined ? Number(explicit.min) : 0,
        max: explicit.max !== undefined ? Number(explicit.max) : 65535
      };
    }
    if (explicit.type === 'readonly' || explicit.type === 'none') {
      return { type: 'readonly', options: inferred.options };
    }
  }
  return inferred;
}

function decodeRegisterStateInfo(tab, idx, rawVal) {
  if (rawVal === undefined || rawVal === null || !tab) return null;
  const numVal = Number(rawVal);
  if (isNaN(numVal)) return null;
  const ctrl = getEffectiveControlConfig(tab, idx);
  const rawTag = String(getPointMeta(tab.tags, idx, tab.start_addr, "") || "");

  const opts = ctrl.options || [];
  if (opts.length > 0) {
    const matched = opts.find(o => Number(o.value) === numVal);
    if (matched) {
      const upper = matched.label.toUpperCase();
      let tone = 'purple';
      if (upper === 'ON' || upper === 'RUN' || upper === 'ACTIVE' || upper === 'AUTO' || upper === 'MASTER') tone = 'emerald';
      else if (upper === 'OFF' || upper === 'STOP' || upper === 'IDLE' || upper === 'NONE') tone = 'slate';
      else if (upper.includes('ERR') || upper.includes('FAULT') || upper.includes('RESET')) tone = 'amber';
      return {
        badgeText: `${matched.label} (${numVal})`,
        shortLabel: matched.label,
        tone
      };
    }
  }

  if (tab.fn_code === 1 || tab.fn_code === 2 || ctrl.type === 'toggle' || /^(DI\d+_STATE|RL\d+|OUT12V_\d+)\b/i.test(rawTag)) {
    const onVal = ctrl.onValue !== undefined ? Number(ctrl.onValue) : 1;
    const isOn = (numVal === onVal) || (tab.fn_code <= 2 && numVal > 0);
    return {
      badgeText: isOn ? `● ON (${numVal})` : `○ OFF (${numVal})`,
      shortLabel: isOn ? 'ON' : 'OFF',
      tone: isOn ? 'emerald' : 'slate'
    };
  }

  if (/BITMAP|DIP_STATE|STATUS_BITS/i.test(rawTag)) {
    const activeBits = [];
    for (let b = 0; b < 16; b++) {
      if ((numVal >> b) & 1) activeBits.push(`B${b}`);
    }
    return {
      badgeText: activeBits.length > 0 ? `Bits ON: ${activeBits.slice(0, 6).join(',')}${activeBits.length > 6 ? '…' : ''}` : 'All Bits OFF (0)',
      shortLabel: activeBits.length > 0 ? `${activeBits.length} bit ON` : '0 bit ON',
      tone: activeBits.length > 0 ? 'cyan' : 'slate'
    };
  }

  return null;
}

// Column 1: Pure Value & Decoded State Badge (Never contains interactive inputs; single-line fixed width so table columns NEVER shift)
function buildValueAndStateCellHtml(tab, idx, rawVal, isDisabled) {
  if (isDisabled) {
    return `<span style="color: #64748b; font-size: 11px;">BỎ QUA</span>`;
  }
  const scale = getPointMeta(tab.scales, idx, tab.start_addr, 1.0);
  const valStr = formatValue(rawVal, tab.format, scale);
  const decoded = decodeRegisterStateInfo(tab, idx, rawVal);
  const decHtml = decoded ? `<span class="decoded-state-pill tone-${decoded.tone}" title="${escapeHtmlStr(decoded.badgeText)}">${escapeHtmlStr(decoded.badgeText)}</span>` : '';
  return `<div class="cell-value-inner">
    <span class="cell-value-num">${valStr}</span>
    ${decHtml}
  </div>`;
}

// Column 2: Dedicated Quick Control Action Column (PURE ACTION BUTTONS ONLY on table — NO live value or live state repainting during polling)
function buildQuickControlCellHtml(tab, idx, rawVal, isDisabled, context) {
  if (isDisabled) {
    return `<span style="color: #64748b; font-size: 10px;">—</span>`;
  }
  const addrDec = tab.start_addr + idx;
  const hasVal = (rawVal !== undefined && rawVal !== null);
  const curNum = hasVal ? Number(rawVal) : NaN;
  const scale = getPointMeta(tab.scales, idx, tab.start_addr, 1.0);
  const unit = getPointMeta(tab.units, idx, tab.start_addr, "");
  const valStr = formatValue(rawVal, tab.format, scale);
  const isReadOnly = isRegisterReadOnly(tab, idx);
  const ctrl = getEffectiveControlConfig(tab, idx);
  const isHardwareReadOnly = (tab.fn_code === 2 || tab.fn_code === 4);
  const isPureTableAction = (context === 'table' || context === 'mobile');

  if (isReadOnly || ctrl.type === 'readonly') {
    if (context === 'scada_card') {
      return `<span class="ro-lock-pill" onclick="toggleRegisterWriteLock(${idx}, event)" title="Thanh ghi đang ở chế độ Chỉ Đọc (Cấm ghi mềm). Nhấn để mở khóa nếu muốn điều khiển.">🔒 Chỉ đọc</span>`;
    }
    return `<div style="display: flex; align-items: center; gap: 4px;" onclick="event.stopPropagation();">
      <span class="ro-lock-pill" onclick="${isHardwareReadOnly ? '' : `toggleRegisterWriteLock(${idx}, event)`}" title="${isHardwareReadOnly ? 'Vùng nhớ FC02/FC04 chỉ đọc theo chuẩn Modbus' : 'Đang bật Cấm Ghi Mềm (Chỉ đọc). Nhấn vào đây để Mở Khóa Ghi cho dòng này'}">
        🔒 Chỉ đọc
      </span>
    </div>`;
  }

  const lockToggleBtn = isPureTableAction
    ? `<span class="rw-unlock-pill" onclick="toggleRegisterWriteLock(${idx}, event)" title="Nhấn để Khóa Ghi Mềm (Chuyển thành 🔒 Chỉ đọc)">🔒</span>`
    : '';

  if (ctrl.type === 'buttons' && Array.isArray(ctrl.options) && ctrl.options.length > 0) {
    const btnsHtml = ctrl.options.map(o => {
      const optVal = Number(o.value);
      const upper = String(o.label).toUpperCase();
      let btnStyleClass = '';
      if (isPureTableAction) {
        if (upper === 'OFF' || upper === 'STOP' || upper === 'IDLE') btnStyleClass = 'btn-cmd-off';
        else if (upper === 'ON' || upper === 'RUN' || upper === 'MASTER') btnStyleClass = 'btn-cmd-on';
      } else if (hasVal && curNum === optVal) {
        if (upper === 'OFF' || upper === 'STOP' || upper === 'IDLE' || (optVal === 0 && !upper.includes('ON'))) btnStyleClass = 'active-off';
        else if (upper === 'ON' || upper === 'RUN' || upper === 'MASTER' || optVal === 1) btnStyleClass = 'active-on';
        else btnStyleClass = 'active-mode';
      }
      return `<button type="button" class="qc-mode-btn ${btnStyleClass}" data-write-val="${optVal}" onclick="quickControlWrite('${tab.id}', ${addrDec}, ${optVal}, event)" title="Ghi ngay lệnh [${optVal}] ${escapeHtmlStr(o.label)} xuống địa chỉ ${addrDec}">${escapeHtmlStr(o.label)}</button>`;
    }).join('');
    return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: nowrap;" onclick="event.stopPropagation();">
      <div class="qc-mode-btn-group">${btnsHtml}</div>
      ${lockToggleBtn}
    </div>`;
  }

  if (ctrl.type === 'toggle') {
    const onVal = ctrl.onValue !== undefined ? Number(ctrl.onValue) : 1;
    const offVal = ctrl.offValue !== undefined ? Number(ctrl.offValue) : 0;
    const isOn = !isPureTableAction && hasVal && curNum === onVal;
    const isOff = !isPureTableAction && hasVal && curNum === offVal;
    return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: nowrap;" onclick="event.stopPropagation();">
      <div class="qc-mode-btn-group">
        <button type="button" class="qc-mode-btn ${isPureTableAction ? 'btn-cmd-on' : (isOn ? 'active-on' : '')}" data-write-val="${onVal}" data-role="on" onclick="quickControlWrite('${tab.id}', ${addrDec}, ${onVal}, event)" title="Ghi ${onVal} (BẬT) xuống địa chỉ ${addrDec}">🟢 BẬT</button>
        <button type="button" class="qc-mode-btn ${isPureTableAction ? 'btn-cmd-off' : (isOff ? 'active-off' : '')}" data-write-val="${offVal}" data-role="off" onclick="quickControlWrite('${tab.id}', ${addrDec}, ${offVal}, event)" title="Ghi ${offVal} (TẮT) xuống địa chỉ ${addrDec}">⚪ TẮT</button>
      </div>
      ${lockToggleBtn}
    </div>`;
  }

  if (ctrl.type === 'dropdown' && Array.isArray(ctrl.options) && ctrl.options.length > 0) {
    let optsHtml = '';
    if (isPureTableAction) {
      optsHtml = `<option value="" selected>⚡ Chọn lệnh ghi...</option>` + ctrl.options.map(o =>
        `<option value="${o.value}">[${o.value}] ${escapeHtmlStr(o.label)}</option>`
      ).join('');
    } else {
      const hasMatch = ctrl.options.some(o => Number(o.value) === curNum);
      if (!hasMatch) {
        optsHtml += `<option value="${hasVal ? curNum : ''}" selected>${hasVal ? `Giá trị: ${curNum}` : '-- Chọn --'}</option>`;
      }
      optsHtml += ctrl.options.map(o =>
        `<option value="${o.value}" ${Number(o.value) === curNum ? 'selected' : ''}>[${o.value}] ${escapeHtmlStr(o.label)}</option>`
      ).join('');
    }
    return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: nowrap;" onclick="event.stopPropagation();">
      <select class="qc-select" data-qc-role="dropdown" onchange="if(this.value!==''){quickControlWrite('${tab.id}', ${addrDec}, parseInt(this.value), event);if(${isPureTableAction})this.value='';}" title="Chọn chế độ để ghi xuống địa chỉ ${addrDec}">
        ${optsHtml}
      </select>
      ${lockToggleBtn}
    </div>`;
  }

  const step = ctrl.step !== undefined ? Number(ctrl.step) : 1;
  if (isPureTableAction) {
    return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: nowrap;" onclick="event.stopPropagation();">
      <div class="qc-stepper-wrap">
        <button type="button" class="qc-step-btn" onclick="quickStepRegisterValue('${tab.id}', ${idx}, ${-step}, event)" title="Giảm -${step} ${unit}">−</button>
        <input type="number" step="any" class="qc-inline-num" data-qc-role="num-input" value="" placeholder="Ghi số..."
          onkeydown="onInlineCellValueKeydown('${tab.id}', ${idx}, this, event)"
          title="Nhập giá trị cần ghi rồi nhấn Enter (Không tự vẽ lại khi đang đọc)">
        <button type="button" class="qc-step-btn" onclick="quickStepRegisterValue('${tab.id}', ${idx}, ${step}, event)" title="Tăng +${step} ${unit}">+</button>
      </div>
      ${lockToggleBtn}
    </div>`;
  }
  const dispNum = hasVal ? valStr : "0";
  return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: wrap;" onclick="event.stopPropagation();">
    <div class="qc-stepper-wrap">
      <button type="button" class="qc-step-btn" onclick="quickStepRegisterValue('${tab.id}', ${idx}, ${-step}, event)" title="Giảm -${step} ${unit}">−</button>
      <input type="number" step="any" class="qc-inline-num" data-qc-role="num-input" value="${dispNum}"
        onkeydown="onInlineCellValueKeydown('${tab.id}', ${idx}, this, event)"
        title="Nhập số rồi nhấn Enter để ghi ngay">
      <button type="button" class="qc-step-btn" onclick="quickStepRegisterValue('${tab.id}', ${idx}, ${step}, event)" title="Tăng +${step} ${unit}">+</button>
    </div>
    ${lockToggleBtn}
  </div>`;
}

function patchQuickControlLiveState(containerEl, tab, idx, rawVal) {
  if (!containerEl || !tab) return;
  if (containerEl.contains(document.activeElement)) return;
  if (containerEl.matches(':hover')) return;

  const hasVal = (rawVal !== undefined && rawVal !== null);
  const curNum = hasVal ? Number(rawVal) : NaN;
  const scale = getPointMeta(tab.scales, idx, tab.start_addr, 1.0);
  const valStr = formatValue(rawVal, tab.format, scale);

  const modeBtns = containerEl.querySelectorAll('.qc-mode-btn[data-write-val]');
  if (modeBtns.length > 0) {
    modeBtns.forEach(btn => {
      const targetVal = Number(btn.getAttribute('data-write-val'));
      const isAct = hasVal && curNum === targetVal;
      btn.classList.remove('active-on', 'active-off', 'active-mode');
      if (isAct) {
        const txt = (btn.textContent || '').toUpperCase();
        if (btn.getAttribute('data-role') === 'off' || txt.includes('OFF') || txt.includes('TẮT') || (targetVal === 0 && !txt.includes('ON'))) {
          btn.classList.add('active-off');
        } else if (btn.getAttribute('data-role') === 'on' || txt.includes('ON') || txt.includes('BẬT') || txt.includes('MASTER') || targetVal === 1) {
          btn.classList.add('active-on');
        } else {
          btn.classList.add('active-mode');
        }
      }
    });
  }

  const selEl = containerEl.querySelector('select.qc-select');
  if (selEl && document.activeElement !== selEl && hasVal) {
    const strV = String(curNum);
    if (selEl.value !== strV) {
      selEl.value = strV;
    }
  }

  const numInput = containerEl.querySelector('input.qc-inline-num');
  if (numInput && document.activeElement !== numInput && hasVal) {
    if (numInput.value !== String(valStr)) {
      numInput.value = valStr;
    }
  }
}

async function quickControlWrite(tabId, addrDec, writeVal, ev) {
  if (ev) ev.stopPropagation();
  const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
  if (!tab || isNaN(Number(writeVal))) return;
  const idx = addrDec - tab.start_addr;
  if (idx >= 0 && idx < tab.count && isRegisterReadOnly(tab, idx)) {
    showToast(`🔒 Địa chỉ ${addrDec} đang bật Cấm Ghi Mềm (Chỉ đọc). Nhấn vào nhãn 🔒 Chỉ đọc nếu muốn mở khóa!`);
    return;
  }
  const numVal = Math.round(Number(writeVal));
  const fn = (tab.fn_code === 1 || tab.fn_code === 2) ? 5 : 6;
  const clickedBtn = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('button') : null;
  if (clickedBtn) {
    clickedBtn.classList.add('qc-btn-sending');
    setTimeout(() => clickedBtn.classList.remove('qc-btn-sending'), 280);
  }

  try {
    const res = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: tab.port,
        baud: tab.baud,
        parity: tab.parity || 'N',
        stopbits: tab.stopbits || 1,
        slave_id: tab.slave_id,
        fn_code: fn,
        address: addrDec,
        value: numVal
      })
    });
    const data = await res.json();
    if (data.success) {
      const nowStr = new Date().toTimeString().split(' ')[0];
      if (!Array.isArray(tab.values)) tab.values = [];
      const rawTag = getPointMeta(tab.tags, idx, tab.start_addr, "");
      if (idx >= 0 && idx < tab.count) {
        // Smart optimistic prediction for Toggle (2) on 0=OFF,1=ON,2=Toggle relays
        if (numVal === 2 && /2\s*=\s*Toggle/i.test(rawTag) && (tab.values[idx] === 0 || tab.values[idx] === 1)) {
          tab.values[idx] = tab.values[idx] === 1 ? 0 : 1;
        } else {
          tab.values[idx] = numVal;
        }
        if (!tab.lastUpdatedMap) tab.lastUpdatedMap = {};
        tab.lastUpdatedMap[idx] = nowStr;
      }
      if (data.tx_hex && data.rx_hex) {
        appendTrafficLog('TX', data.tx_hex, 0, shortPortLabel(tab.port));
        appendTrafficLog('RX', data.rx_hex, data.latency_ms, shortPortLabel(tab.port));
      }
      const tagLbl = rawTag || `Addr ${addrDec}`;
      showToast(`⚡ Đã ghi [${tagLbl}] = ${numVal} (${data.latency_ms || 0}ms)`);
      if (typeof ingestPollIntoTrendStudio === 'function') ingestPollIntoTrendStudio(tab, nowStr);
      if (tab.id === activeTabId) {
        updateTableLiveValuesInPlace(tab);
        const cVal = document.getElementById(`cellVal_${idx}`);
        const mVal = document.getElementById(`mobVal_${idx}`);
        [cVal, mVal].forEach(el => {
          if (el) {
            el.classList.remove('val-updated-flash');
            void el.offsetWidth;
            el.classList.add('val-updated-flash');
          }
        });
        updateInspector();
      }
      if (currentView === 'trend' && typeof updateTrendCardsLiveValuesInPlace === 'function') {
        updateTrendCardsLiveValuesInPlace();
      }
      executePoll(tab);
    } else {
      showToast(`❌ Lỗi ghi địa chỉ ${addrDec}: ${data.error || 'Thất bại'}`);
    }
  } catch (e) {
    showToast(`❌ Lỗi kết nối khi ghi: ${e}`);
  }
}

function quickStepRegisterValue(tabId, idx, deltaScaled, ev) {
  if (ev) ev.stopPropagation();
  const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
  if (!tab) return;
  const addrDec = tab.start_addr + idx;
  const scale = Number(getPointMeta(tab.scales, idx, tab.start_addr, 1.0)) || 1.0;
  const curRaw = (Array.isArray(tab.values) && tab.values[idx] !== undefined && tab.values[idx] !== null) ? Number(tab.values[idx]) : 0;
  const curScaled = curRaw * scale;
  const ctrl = getEffectiveControlConfig(tab, idx);
  let nextScaled = curScaled + Number(deltaScaled);
  if (ctrl.min !== undefined && nextScaled < Number(ctrl.min)) nextScaled = Number(ctrl.min);
  if (ctrl.max !== undefined && nextScaled > Number(ctrl.max)) nextScaled = Number(ctrl.max);
  let nextRaw = Math.round(nextScaled / scale);
  if (nextRaw < 0) nextRaw = (nextRaw + 65536) & 0xFFFF;
  quickControlWrite(tab.id, addrDec, nextRaw, ev);
}

function onInlineCellValueKeydown(tabId, idx, inputEl, ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.stopPropagation();
    const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
    if (!tab || !inputEl) return;
    const addrDec = tab.start_addr + idx;
    const scale = Number(getPointMeta(tab.scales, idx, tab.start_addr, 1.0)) || 1.0;
    const typed = parseFloat(inputEl.value);
    if (isNaN(typed)) return;
    let rawToWrite = Math.round(typed / scale);
    if (rawToWrite < 0) rawToWrite = (rawToWrite + 65536) & 0xFFFF;
    inputEl.blur();
    quickControlWrite(tab.id, addrDec, rawToWrite, ev);
  }
}

function promptInlineEditTag(idx, ev) {
  if (ev) ev.stopPropagation();
  openRegisterCrudModal('edit', idx);
}

// ==================== REGISTER ADD / EDIT / DELETE MODAL ON POLL TABLE ====================
function openRegisterCrudModal(mode, rowIdx, ev) {
  if (ev) ev.stopPropagation();
  const t = getActiveTab();
  if (!t) return;
  const modal = document.getElementById('registerCrudModal');
  if (!modal) return;

  const isEdit = (mode === 'edit' && rowIdx !== undefined && rowIdx >= 0 && rowIdx < t.count);
  document.getElementById('regCrudMode').value = isEdit ? 'edit' : 'add';
  const titleEl = document.getElementById('lblRegCrudModalTitle');
  const delBtn = document.getElementById('btnRegCrudDelete');
  const gapWrap = document.getElementById('regCrudAutoDisableGapWrap');

  if (isEdit) {
    const addrDec = t.start_addr + rowIdx;
    document.getElementById('regCrudOrigAddr').value = String(addrDec);
    document.getElementById('regCrudAddr').value = String(addrDec);
    document.getElementById('regCrudTag').value = getPointMeta(t.tags, rowIdx, t.start_addr, "");
    document.getElementById('regCrudUnit').value = getPointMeta(t.units, rowIdx, t.start_addr, "");
    document.getElementById('regCrudScale').value = getPointMeta(t.scales, rowIdx, t.start_addr, 1.0);
    document.getElementById('regCrudReadEnabled').checked = !isRegisterDisabled(t, rowIdx);
    document.getElementById('regCrudWriteLocked').checked = isRegisterReadOnly(t, rowIdx);

    const expCtrl = t.controls ? getPointMeta(t.controls, rowIdx, t.start_addr, null) : null;
    const effCtrl = getEffectiveControlConfig(t, rowIdx);
    const ctrlTypeVal = (expCtrl && expCtrl.type) ? expCtrl.type : 'auto';
    document.getElementById('regCrudCtrlType').value = ctrlTypeVal;
    document.getElementById('regCrudCtrlOptions').value = formatMultistateOptionsSpec(effCtrl.options || [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }, { value: 2, label: 'Toggle' }]);
    if (titleEl) titleEl.textContent = `✏️ Sửa Thanh Ghi #${addrDec} (0x${addrDec.toString(16).toUpperCase().padStart(4, '0')})`;
    if (delBtn) delBtn.style.display = 'inline-flex';
    if (gapWrap) gapWrap.style.display = 'none';
  } else {
    const nextAddr = t.start_addr + t.count;
    document.getElementById('regCrudOrigAddr').value = "-1";
    document.getElementById('regCrudAddr').value = String(nextAddr);
    document.getElementById('regCrudTag').value = "";
    document.getElementById('regCrudUnit').value = "";
    document.getElementById('regCrudScale').value = "1";
    document.getElementById('regCrudReadEnabled').checked = true;
    document.getElementById('regCrudWriteLocked').checked = false;
    document.getElementById('regCrudCtrlType').value = 'auto';
    document.getElementById('regCrudCtrlOptions').value = "0=OFF, 1=ON, 2=Toggle";
    if (titleEl) titleEl.textContent = `➕ Thêm Thanh Ghi Mới Vào Bảng Dữ Liệu (${t.name})`;
    if (delBtn) delBtn.style.display = 'none';
    if (gapWrap) gapWrap.style.display = 'block';
  }
  onRegCrudCtrlTypeChange();
  modal.classList.add('open');
}

function closeRegisterCrudModal() {
  const modal = document.getElementById('registerCrudModal');
  if (modal) modal.classList.remove('open');
}

function onRegCrudCtrlTypeChange() {
  const sel = document.getElementById('regCrudCtrlType')?.value || 'auto';
  const box = document.getElementById('regCrudOptionsBox');
  if (box) {
    box.style.display = (sel === 'buttons' || sel === 'dropdown') ? 'flex' : 'none';
  }
  if (sel === 'readonly') {
    const chkRo = document.getElementById('regCrudWriteLocked');
    if (chkRo) chkRo.checked = true;
  }
}

function rebaseTabMetadataToNewRange(tab, newStart, newCount) {
  const oldStart = tab.start_addr;
  const oldCount = tab.count;
  const newTags = {}, newUnits = {}, newScales = {}, newControls = {}, newValues = [];
  for (let i = 0; i < oldCount; i++) {
    const addr = oldStart + i;
    const newIdx = addr - newStart;
    if (newIdx < 0 || newIdx >= newCount) continue;
    const tg = getPointMeta(tab.tags, i, oldStart, undefined);
    const un = getPointMeta(tab.units, i, oldStart, undefined);
    const sc = getPointMeta(tab.scales, i, oldStart, undefined);
    const ct = tab.controls ? getPointMeta(tab.controls, i, oldStart, undefined) : undefined;
    if (tg !== undefined && tg !== "") newTags[String(newIdx)] = tg;
    if (un !== undefined && un !== "") newUnits[String(newIdx)] = un;
    if (sc !== undefined && sc !== 1 && sc !== 1.0) newScales[String(newIdx)] = sc;
    if (ct !== undefined) newControls[String(newIdx)] = ct;
    if (Array.isArray(tab.values) && tab.values[i] !== undefined) newValues[newIdx] = tab.values[i];
  }
  tab.start_addr = newStart;
  tab.count = newCount;
  tab.tags = newTags;
  tab.units = newUnits;
  tab.scales = newScales;
  tab.controls = newControls;
  tab.values = newValues;
}

function saveRegisterCrudModal() {
  const t = getActiveTab();
  if (!t) return;
  pushInspectorUndoSnapshot(t, "Sửa/Thêm thanh ghi trong hộp thoại");
  const targetAddr = Math.max(0, Math.min(65535, parseInt(document.getElementById('regCrudAddr')?.value) || 0));
  const tagVal = (document.getElementById('regCrudTag')?.value || '').trim();
  const unitVal = (document.getElementById('regCrudUnit')?.value || '').trim();
  const scaleVal = parseFloat(document.getElementById('regCrudScale')?.value);
  const readEnabled = Boolean(document.getElementById('regCrudReadEnabled')?.checked);
  const writeLocked = Boolean(document.getElementById('regCrudWriteLocked')?.checked);
  const ctrlType = document.getElementById('regCrudCtrlType')?.value || 'auto';
  const ctrlOptsStr = (document.getElementById('regCrudCtrlOptions')?.value || '').trim();
  const autoDisableGap = Boolean(document.getElementById('regCrudDisableGap')?.checked);

  const curMin = t.start_addr;
  const curMax = t.start_addr + t.count - 1;
  const disSet = parseAddrRangeSet(t.disabled_addrs);

  if (targetAddr < curMin || targetAddr > curMax) {
    const newMin = Math.min(curMin, targetAddr);
    const newMax = Math.max(curMax, targetAddr);
    const newCount = newMax - newMin + 1;
    if (newCount > 250) {
      alert(`Khoảng cách từ địa chỉ ${newMin} đến ${newMax} là ${newCount} thanh ghi (vượt giới hạn 250 thanh ghi/Tab). Hãy tạo Tab mới cho vùng địa chỉ cách xa này!`);
      return;
    }
    if (autoDisableGap) {
      for (let a = newMin; a < curMin; a++) {
        if (a !== targetAddr) disSet.add(a);
      }
      for (let a = curMax + 1; a <= newMax; a++) {
        if (a !== targetAddr) disSet.add(a);
      }
    }
    rebaseTabMetadataToNewRange(t, newMin, newCount);
  }

  const idx = targetAddr - t.start_addr;
  setPointMeta(t.tags, idx, t.start_addr, tagVal);
  setPointMeta(t.units, idx, t.start_addr, unitVal);
  setPointMeta(t.scales, idx, t.start_addr, isNaN(scaleVal) ? 1.0 : scaleVal);

  if (readEnabled) disSet.delete(targetAddr);
  else disSet.add(targetAddr);
  t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);

  const roSet = parseAddrRangeSet(t.read_only_addrs);
  const rwSet = parseAddrRangeSet(t.writable_addrs);
  if (writeLocked || ctrlType === 'readonly') {
    roSet.add(targetAddr);
    rwSet.delete(targetAddr);
  } else {
    roSet.delete(targetAddr);
    rwSet.add(targetAddr);
  }
  t.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
  t.writable_addrs = Array.from(rwSet).sort((a, b) => a - b);

  if (!t.controls) t.controls = {};
  if (ctrlType === 'auto') {
    setPointMeta(t.controls, idx, t.start_addr, undefined);
  } else if (ctrlType === 'readonly') {
    setPointMeta(t.controls, idx, t.start_addr, { type: 'readonly' });
  } else if (ctrlType === 'buttons' || ctrlType === 'dropdown') {
    const opts = parseMultistateOptionsSpec(ctrlOptsStr);
    setPointMeta(t.controls, idx, t.start_addr, {
      type: ctrlType,
      options: opts.length > 0 ? opts : [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }]
    });
  } else if (ctrlType === 'toggle') {
    setPointMeta(t.controls, idx, t.start_addr, { type: 'toggle', onValue: 1, offValue: 0 });
  } else if (ctrlType === 'stepper') {
    setPointMeta(t.controls, idx, t.start_addr, { type: 'stepper', step: 1, min: 0, max: 65535 });
  }

  t.selectedIndex = idx;
  closeRegisterCrudModal();
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
  showToast(`✔ Đã lưu cấu hình thanh ghi Addr ${targetAddr} [${tagVal || 'Điểm #' + targetAddr}]!`);
}

function deleteOrMaskRegisterRow(idx, ev) {
  if (ev) ev.stopPropagation();
  const t = getActiveTab();
  if (!t || idx < 0 || idx >= t.count) return;
  const addrDec = t.start_addr + idx;
  pushInspectorUndoSnapshot(t, `Xóa/Khóa dòng #${addrDec}`);
  const curMin = t.start_addr;
  const curMax = t.start_addr + t.count - 1;

  if (t.count > 1 && addrDec === curMin) {
    rebaseTabMetadataToNewRange(t, curMin + 1, t.count - 1);
    const disSet = parseAddrRangeSet(t.disabled_addrs);
    disSet.delete(addrDec);
    t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
    showToast(`🗑️ Đã xóa dòng đầu Addr ${addrDec} (Phạm vi mới: ${t.start_addr}..${t.start_addr + t.count - 1}).`);
  } else if (t.count > 1 && addrDec === curMax) {
    rebaseTabMetadataToNewRange(t, curMin, t.count - 1);
    const disSet = parseAddrRangeSet(t.disabled_addrs);
    disSet.delete(addrDec);
    t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
    showToast(`🗑️ Đã xóa dòng cuối Addr ${addrDec} (Phạm vi mới: ${t.start_addr}..${t.start_addr + t.count - 1}).`);
  } else {
    setPointMeta(t.tags, idx, t.start_addr, "");
    setPointMeta(t.units, idx, t.start_addr, "");
    setPointMeta(t.scales, idx, t.start_addr, 1.0);
    if (t.controls) setPointMeta(t.controls, idx, t.start_addr, undefined);
    const disSet = parseAddrRangeSet(t.disabled_addrs);
    disSet.add(addrDec);
    t.disabled_addrs = Array.from(disSet).sort((a, b) => a - b);
    showToast(`🗑️ Đã xóa Tag & Cấm đọc thanh ghi giữa Addr ${addrDec} (Bật 'Ẩn dòng Cấm Đọc' nếu muốn ẩn khỏi bảng).`);
  }

  t.selectedIndex = Math.max(0, Math.min(idx, t.count - 1));
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  saveUiStateToStorage();
}

function deleteRegisterFromCrudModal() {
  const t = getActiveTab();
  if (!t) return;
  const origAddr = parseInt(document.getElementById('regCrudOrigAddr')?.value);
  closeRegisterCrudModal();
  if (!isNaN(origAddr) && origAddr >= t.start_addr && origAddr < t.start_addr + t.count) {
    deleteOrMaskRegisterRow(origAddr - t.start_addr);
  }
}

function clearSelectedPointMeta() {
  const t = getActiveTab();
  if (!t) return;
  pushInspectorUndoSnapshot(t, "Xóa cấu hình Tag");
  const idx = t.selectedIndex || 0;
  const addrDec = t.start_addr + idx;
  setPointMeta(t.tags, idx, t.start_addr, "");
  setPointMeta(t.units, idx, t.start_addr, "");
  setPointMeta(t.scales, idx, t.start_addr, 1.0);
  if (t.controls) setPointMeta(t.controls, idx, t.start_addr, undefined);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  saveUiStateToStorage();
  showToast(`🗑️ Đã xóa cấu hình Tag tại địa chỉ ${addrDec} (Nhấn ↩️ Back để hoàn tác).`);
}

function onInspectorControlTypeChange(newType) {
  const boxToggle = document.getElementById('boxInspCtrlToggle');
  const boxStep = document.getElementById('boxInspCtrlStepper');
  const boxDrop = document.getElementById('boxInspCtrlDropdown');
  if (boxToggle) boxToggle.style.display = (newType === 'toggle') ? 'flex' : 'none';
  if (boxStep) boxStep.style.display = (newType === 'stepper') ? 'flex' : 'none';
  if (boxDrop) boxDrop.style.display = (newType === 'dropdown' || newType === 'buttons') ? 'flex' : 'none';
  saveInspectorControlConfig(true);
}

function saveInspectorControlConfig(showConfirmToast) {
  const t = getActiveTab();
  if (!t) return;
  pushInspectorUndoSnapshot(t, "Đổi cấu hình điều khiển");
  if (!t.controls) t.controls = {};
  const idx = t.selectedIndex || 0;
  const addrDec = t.start_addr + idx;
  const ctrlType = document.getElementById('selInspCtrlType')?.value || 'auto';
  const roSet = parseAddrRangeSet(t.read_only_addrs);
  const rwSet = parseAddrRangeSet(t.writable_addrs);

  if (ctrlType === 'readonly' || ctrlType === 'none') {
    roSet.add(addrDec);
    rwSet.delete(addrDec);
    setPointMeta(t.controls, idx, t.start_addr, { type: 'readonly' });
  } else {
    roSet.delete(addrDec);
    if (ctrlType !== 'auto') rwSet.add(addrDec);
    if (ctrlType === 'auto') {
      setPointMeta(t.controls, idx, t.start_addr, undefined);
    } else if (ctrlType === 'toggle') {
      const onVal = parseInt(document.getElementById('inpInspCtrlOnVal')?.value);
      const offVal = parseInt(document.getElementById('inpInspCtrlOffVal')?.value);
      setPointMeta(t.controls, idx, t.start_addr, {
        type: 'toggle',
        onValue: isNaN(onVal) ? 1 : onVal,
        offValue: isNaN(offVal) ? 0 : offVal
      });
    } else if (ctrlType === 'stepper') {
      const step = parseFloat(document.getElementById('inpInspCtrlStep')?.value);
      const min = parseFloat(document.getElementById('inpInspCtrlMin')?.value);
      const max = parseFloat(document.getElementById('inpInspCtrlMax')?.value);
      setPointMeta(t.controls, idx, t.start_addr, {
        type: 'stepper',
        step: isNaN(step) || step <= 0 ? 1 : step,
        min: isNaN(min) ? 0 : min,
        max: isNaN(max) ? 65535 : max
      });
    } else if (ctrlType === 'dropdown' || ctrlType === 'buttons') {
      const optStr = document.getElementById('inpInspCtrlOptions')?.value || '0=OFF, 1=ON';
      const opts = parseMultistateOptionsSpec(optStr);
      setPointMeta(t.controls, idx, t.start_addr, {
        type: ctrlType,
        options: opts.length > 0 ? opts : [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }]
      });
    }
  }
  t.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
  t.writable_addrs = Array.from(rwSet).sort((a, b) => a - b);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (typeof renderTrendStudioView === 'function' && currentView === 'trend') renderTrendStudioView();
  saveUiStateToStorage();
  if (showConfirmToast) {
    showToast(`✔ Đã áp dụng cấu hình điều khiển cho địa chỉ ${addrDec} (Nhấn ↩️ Back nếu muốn hoàn tác)!`);
  }
}

function isPointWatchedInTrend(tabId, addrDec) {
  if (!Array.isArray(trendWatches)) return false;
  return trendWatches.some(w => w.tabId === tabId && Number(w.addr) === Number(addrDec));
}

function togglePointInTrend(tabId, idx, ev) {
  if (ev) ev.stopPropagation();
  const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
  if (!tab) return;
  if (typeof toggleTrendWatchItem === 'function') {
    toggleTrendWatchItem(tab, idx);
  }
  renderTable();
  updateInspector();
}

function toggleSelectedPointInTrend() {
  const t = getActiveTab();
  if (!t) return;
  togglePointInTrend(t.id, t.selectedIndex || 0);
}

// ==================== TABLE & MOBILE CARD RENDERING + IN-PLACE LIVE POLL UPDATE ====================
function computeTableStructureSig(t, hideDisabled) {
  if (!t) return "";
  return `${t.id}:${t.start_addr}:${t.count}:${t.fn_code}:${t.format}:${hideDisabled ? 1 : 0}:${(t.disabled_addrs || []).join(',')}:${(t.read_only_addrs || []).join(',')}:${t.only_tagged ? 1 : 0}`;
}

function buildRowStatusBadgeHtml(t, addrDec, isDisabled, hasVal, errAddrSet) {
  if (isDisabled) {
    return `<span class="badge badge-slate" style="color: var(--amber); border-color: rgba(245,158,11,0.35);" title="Thanh ghi này đã được khóa — Không gửi lệnh Modbus tới địa chỉ ${addrDec}">🚫 CẤM ĐỌC</span>`;
  }
  if (hasVal) {
    return `<span class="badge badge-emerald">✔ OK</span>`;
  }
  if (errAddrSet && errAddrSet.has(addrDec)) {
    return `<span class="badge badge-rose" title="Khối chứa thanh ghi này trả về lỗi Modbus Exception">❌ LỖI KHỐI</span>`;
  }
  if (t.lastPollState === 'error') {
    return `<span class="badge badge-rose" title="${t.lastError || 'Timeout'}">⚠️ TIMEOUT</span>`;
  }
  return `<span class="badge badge-slate">⏳ CHỜ ĐỌC</span>`;
}

// In-Place DOM Update during polling so open <select> dropdowns & <input> fields NEVER get wiped!
function updateTableLiveValuesInPlace(t) {
  const tbody = document.getElementById('tblRegisters');
  if (!tbody || !t) return;
  const hideDisabled = Boolean(document.getElementById('chkHideDisabled')?.checked);
  const expectedSig = computeTableStructureSig(t, hideDisabled);
  if (tbody.dataset.renderedSig !== expectedSig) {
    renderTable();
    return;
  }

  const errAddrSet = new Set();
  if (Array.isArray(t.blockErrors)) {
    t.blockErrors.forEach(be => {
      if (be && typeof be === 'object') {
        for (let a = be.start_addr; a < be.start_addr + be.count; a++) errAddrSet.add(a);
      }
    });
  }

  for (let i = 0; i < t.count; i++) {
    const addrDec = t.start_addr + i;
    const isDisabled = isRegisterDisabled(t, i);
    if (hideDisabled && isDisabled) continue;

    const raw = Array.isArray(t.values) ? t.values[i] : undefined;
    const hasVal = (raw !== undefined && raw !== null);
    const rawHex = hasVal ? ("0x" + (raw & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")) : "--";
    const scale = getPointMeta(t.scales, i, t.start_addr, 1.0);
    const updatedAtStr = (!isDisabled && t.lastUpdatedMap && t.lastUpdatedMap[i]) ? t.lastUpdatedMap[i] : (hasVal && t.lastUpdated ? t.lastUpdated : "--");
    const newValHtml = buildValueAndStateCellHtml(t, i, raw, isDisabled);
    const newStatusHtml = buildRowStatusBadgeHtml(t, addrDec, isDisabled, hasVal, errAddrSet);

    const cellVal = document.getElementById(`cellVal_${i}`);
    if (cellVal && cellVal.innerHTML !== newValHtml) {
      cellVal.innerHTML = newValHtml;
    }

    // NOTE: cellQuickCtrl_${i} & mobQuickCtrl_${i} are NEVER touched during polling so action buttons stay 100% static without repainting!

    const cellHex = document.getElementById(`cellHex_${i}`);
    if (cellHex && cellHex.textContent !== rawHex) cellHex.textContent = rawHex;

    const cellTime = document.getElementById(`cellTime_${i}`);
    if (cellTime) {
      if (cellTime.textContent !== updatedAtStr) cellTime.textContent = updatedAtStr;
      cellTime.style.color = updatedAtStr !== '--' ? '#38bdf8' : '#64748b';
    }

    const cellStatus = document.getElementById(`cellStatus_${i}`);
    if (cellStatus && cellStatus.innerHTML !== newStatusHtml) {
      cellStatus.innerHTML = newStatusHtml;
    }

    // In-Place Live Update for Mobile Register Cards (#mobileRegisterCards) — Zero scroll jump or card flicker!
    const mobVal = document.getElementById(`mobVal_${i}`);
    if (mobVal && mobVal.innerHTML !== newValHtml) {
      mobVal.innerHTML = newValHtml;
    }

    const mobRaw = document.getElementById(`mobRaw_${i}`);
    const expectedMobRaw = `RAW: ${rawHex} • ×${scale}`;
    if (mobRaw && mobRaw.textContent !== expectedMobRaw) {
      mobRaw.textContent = expectedMobRaw;
    }

    const mobTime = document.getElementById(`mobTime_${i}`);
    if (mobTime) {
      const expectedMobTime = updatedAtStr !== '--' ? `🕒 ${updatedAtStr}` : '';
      if (mobTime.textContent !== expectedMobTime) mobTime.textContent = expectedMobTime;
    }

    const mobStatus = document.getElementById(`mobStatus_${i}`);
    if (mobStatus && mobStatus.innerHTML !== newStatusHtml) {
      mobStatus.innerHTML = newStatusHtml;
    }
  }
}

function renderTable() {
  const t = getActiveTab();
  const tbody = document.getElementById('tblRegisters');
  const cardsBox = document.getElementById('mobileRegisterCards');
  const gridBox = document.getElementById('pollGridContainer');
  if (!tbody || !t) return;
  const savedScrollTop = gridBox ? gridBox.scrollTop : 0;

  const hideDisabled = Boolean(document.getElementById('chkHideDisabled')?.checked);
  tbody.dataset.renderedSig = computeTableStructureSig(t, hideDisabled);

  const errAddrSet = new Set();
  if (Array.isArray(t.blockErrors)) {
    t.blockErrors.forEach(be => {
      if (be && typeof be === 'object') {
        for (let a = be.start_addr; a < be.start_addr + be.count; a++) errAddrSet.add(a);
      }
    });
  } else if (t.blockErrors && typeof t.blockErrors === 'object') {
    Object.keys(t.blockErrors).forEach(k => {
      const a = parseInt(k);
      if (!isNaN(a)) errAddrSet.add(a);
    });
  }

  let renderedRows = 0;
  const cardItemsHtml = [];
  const rowFrag = document.createDocumentFragment();

  for (let i = 0; i < t.count; i++) {
    const addrDec = t.start_addr + i;
    const isDisabled = isRegisterDisabled(t, i);
    if (hideDisabled && isDisabled) continue;
    renderedRows++;

    const addrHex = "0x" + addrDec.toString(16).toUpperCase().padStart(4, "0");
    const plcPrefix = (t.fn_code === 3) ? 40001 : (t.fn_code === 4) ? 30001 : (t.fn_code === 1) ? 1 : 10001;
    const plcAddr = plcPrefix + addrDec;
    const raw = Array.isArray(t.values) ? t.values[i] : undefined;
    const hasVal = (raw !== undefined && raw !== null);
    const rawHex = hasVal ? ("0x" + (raw & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")) : "--";
    const rawTag = getPointMeta(t.tags, i, t.start_addr, "");
    const tag = rawTag || `Điểm #${addrDec}`;
    const unit = getPointMeta(t.units, i, t.start_addr, "");
    const scale = getPointMeta(t.scales, i, t.start_addr, 1.0);
    const updatedAtStr = (!isDisabled && t.lastUpdatedMap && t.lastUpdatedMap[i]) ? t.lastUpdatedMap[i] : (hasVal && t.lastUpdated ? t.lastUpdated : "--");
    const isWatched = isPointWatchedInTrend(t.id, addrDec);
    const isReadOnly = isRegisterReadOnly(t, i);
    const valCellHtml = buildValueAndStateCellHtml(t, i, raw, isDisabled);
    const quickCtrlHtml = buildQuickControlCellHtml(t, i, raw, isDisabled, 'table');
    const statusHtml = buildRowStatusBadgeHtml(t, addrDec, isDisabled, hasVal, errAddrSet);

    const tr = document.createElement('tr');
    tr.id = `pollRow_${i}`;
    const classes = [];
    if (i === t.selectedIndex) classes.push("selected");
    if (isDisabled) classes.push("row-disabled");
    tr.className = classes.join(" ");
    tr.onclick = () => selectRow(i, false);
    tr.ondblclick = () => {
      if (!isReadOnly) openQuickWriteModal(addrDec, hasVal ? raw : 0);
      else openRegisterCrudModal('edit', i);
    };

    tr.innerHTML = `
      <td style="text-align: center;" onclick="toggleAddrDisabled(${addrDec}, event)" title="Tích chọn để Đọc thanh ghi ${addrDec}, bỏ tích để Cấm Đọc (tách khối né địa chỉ ${addrDec})">
        <input type="checkbox" ${!isDisabled ? 'checked' : ''} style="cursor: pointer; accent-color: var(--emerald);">
      </td>
      <td style="color: #64748b;">${i + 1}</td>
      <td style="color: var(--cyan); font-weight: 700;">${addrDec}</td>
      <td style="color: #94a3b8;">${addrHex}</td>
      <td style="color: #cbd5e1; font-weight: 600;">${plcAddr}</td>
      <td style="color: ${rawTag ? '#f1f5f9' : '#64748b'}; font-weight: ${rawTag ? '600' : '400'};" title="${escapeHtmlStr(tag)} — Nhấp biểu tượng ✏️ để sửa nhanh Tên Tag, Đơn vị, Hệ số & Kiểu nút điều khiển">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; overflow: hidden;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtmlStr(tag)}</span>
          <button class="btn btn-outline" style="padding: 1px 5px; font-size: 10px; opacity: 0.72; flex-shrink: 0;" onclick="openRegisterCrudModal('edit', ${i}, event)" title="Sửa Thanh Ghi (Tên Tag, Đơn vị, Hệ số, Khóa ghi mềm & Nút điều khiển)">✏️</button>
        </div>
      </td>
      <td id="cellVal_${i}" class="cell-value">${valCellHtml}</td>
      <td id="cellQuickCtrl_${i}">${quickCtrlHtml}</td>
      <td style="color: var(--text-muted); cursor: pointer;" onclick="openRegisterCrudModal('edit', ${i}, event)" title="Nhấp để sửa Đơn vị">${escapeHtmlStr(unit)}</td>
      <td style="color: #64748b; cursor: pointer;" onclick="openRegisterCrudModal('edit', ${i}, event)" title="Nhấp để sửa Hệ số nhân">${scale}</td>
      <td id="cellHex_${i}" style="color: #94a3b8; font-family: monospace;">${rawHex}</td>
      <td id="cellTime_${i}" style="color: ${updatedAtStr !== '--' ? '#38bdf8' : '#64748b'}; font-family: monospace; font-size: 11px;">${updatedAtStr}</td>
      <td id="cellStatus_${i}">${statusHtml}</td>
      <td>
        <div style="display: flex; gap: 3px; align-items: center;" onclick="event.stopPropagation();">
          <button class="btn ${isWatched ? 'btn-primary' : 'btn-outline'}" style="padding: 2px 5px; font-size: 11px; ${isWatched ? '' : 'color: var(--cyan);'}" onclick="togglePointInTrend('${t.id}', ${i}, event)" title="${isWatched ? 'Đang hiển thị trên Thẻ Động & Biểu Đồ Trend (Nhấn để bỏ)' : 'Đưa điểm này vào Bảng Thẻ Động & Biểu Đồ Sóng (Trend)'}">📈</button>
          ${!isReadOnly ? `<button class="btn btn-outline" style="padding: 2px 5px; font-size: 11px;" onclick="openQuickWriteModal(${addrDec}, ${hasVal ? raw : 0})" title="Ghi giá trị thanh ghi ${addrDec}">Ghi</button>` : ''}
          <button class="btn btn-outline" style="padding: 2px 5px; font-size: 11px; color: var(--cyan);" onclick="openInspectorForRow(${i}, event)" title="Mở chi tiết Point Inspector">🔍</button>
          <button class="btn btn-outline" style="padding: 2px 5px; font-size: 11px; color: var(--rose);" onclick="deleteOrMaskRegisterRow(${i}, event)" title="Xóa hoặc Khóa thanh ghi ${addrDec}">🗑️</button>
        </div>
      </td>
    `;
    rowFrag.appendChild(tr);

    if (cardsBox) {
      const mobileCtrlHtml = buildQuickControlCellHtml(t, i, raw, isDisabled, 'mobile');
      cardItemsHtml.push(`
        <div id="mobCard_${i}" class="mobile-reg-card ${isDisabled ? 'is-disabled' : ''} ${i === t.selectedIndex ? 'selected' : ''}" onclick="selectRow(${i}, false)">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="checkbox" ${!isDisabled ? 'checked' : ''} onclick="toggleAddrDisabled(${addrDec}, event)" style="width: 17px; height: 17px; accent-color: var(--emerald); cursor: pointer;">
              <span class="badge badge-cyan" style="font-family: monospace; font-size: 11px;">Addr ${addrDec} (${addrHex})</span>
              <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">#${plcAddr}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span id="mobTime_${i}" style="font-size: 10px; font-family: monospace; color: var(--cyan);">${updatedAtStr !== '--' ? `🕒 ${updatedAtStr}` : ''}</span>
              <span id="mobStatus_${i}">${statusHtml}</span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
            <div style="font-weight: 700; font-size: 14px; color: ${rawTag ? '#fff' : '#94a3b8'}; line-height: 1.3; word-break: break-word;">
              ${escapeHtmlStr(tag)}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span id="mobVal_${i}">${valCellHtml}</span>
              ${unit ? `<span style="font-size: 11px; color: var(--cyan); font-weight: 700;">${escapeHtmlStr(unit)}</span>` : ''}
            </div>
          </div>
          <div id="mobQuickCtrl_${i}" style="margin-top: 4px;">
            ${mobileCtrlHtml}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); border-top: 1px dashed rgba(255,255,255,0.07); padding-top: 6px; margin-top: 4px;">
            <span id="mobRaw_${i}" style="font-family: monospace;">RAW: ${rawHex} • ×${scale}</span>
            <div style="display: flex; gap: 5px;" onclick="event.stopPropagation();">
              <button class="btn ${isWatched ? 'btn-primary' : 'btn-outline'}" style="padding: 3px 8px; font-size: 11px;" onclick="togglePointInTrend('${t.id}', ${i}, event)">
                📈 ${isWatched ? 'Đang Vẽ' : 'Trend'}
              </button>
              <button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px;" onclick="openRegisterCrudModal('edit', ${i}, event)">
                ✏️ Sửa
              </button>
              <button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; color: var(--cyan);" onclick="openInspectorForRow(${i}, event)" title="Chi tiết Point Inspector">
                🔍
              </button>
              <button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; color: var(--rose);" onclick="deleteOrMaskRegisterRow(${i}, event)">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `);
    }
  }

  if (renderedRows === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; color: var(--text-muted); padding: 30px;">Tất cả các dòng trong Tab này đang bị ẩn do bộ lọc 'Ẩn dòng Cấm Đọc'. Bỏ tích 'Ẩn dòng Cấm Đọc' để xem lại.</td></tr>`;
    if (cardsBox) {
      cardsBox.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px;">Đang ẩn các dòng Cấm Đọc.</div>`;
    }
  } else {
    tbody.replaceChildren(rowFrag);
    if (cardsBox) {
      cardsBox.innerHTML = cardItemsHtml.join('');
    }
  }
  if (gridBox) {
    gridBox.scrollTop = savedScrollTop;
  }
}

function selectRow(idx, openInspectorNow) {
  const t = getActiveTab();
  t.selectedIndex = idx;
  const tbody = document.getElementById('tblRegisters');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.classList.toggle('selected', tr.id === `pollRow_${idx}`);
    });
  }
  const cardsBox = document.getElementById('mobileRegisterCards');
  if (cardsBox) {
    cardsBox.querySelectorAll('.mobile-reg-card').forEach(card => {
      card.classList.toggle('selected', card.id === `mobCard_${idx}`);
    });
  }
  updateInspector();
  if (openInspectorNow) {
    const insp = document.getElementById('pointInspector');
    if (insp) insp.classList.remove('collapsed');
  }
  saveUiStateToStorage();
}

function openInspectorForRow(idx, ev) {
  if (ev) ev.stopPropagation();
  selectRow(idx, true);
}

// ==================== POINT INSPECTOR (RESIZABLE + ENTER TO APPLY + UNDO STACK) ====================
function toggleInspector() {
  const insp = document.getElementById('pointInspector');
  if (!insp) return;
  insp.classList.toggle('collapsed');
  if (!insp.classList.contains('collapsed')) {
    setInspectorWidthPreset(inspectorWidthPx || 380, true);
  }
}

function setInspectorWidthPreset(widthPx, silent) {
  const clamped = Math.max(280, Math.min(680, Math.round(Number(widthPx) || 380)));
  inspectorWidthPx = clamped;
  const insp = document.getElementById('pointInspector');
  if (insp) {
    insp.style.setProperty('--inspector-width', `${clamped}px`);
    if (window.innerWidth > 820 && !insp.classList.contains('collapsed')) {
      insp.style.width = `${clamped}px`;
    }
  }
  document.querySelectorAll('.inspector-width-pill').forEach(pill => {
    const txt = (pill.textContent || '').trim();
    const isMatch = (txt === 'S' && Math.abs(clamped - 340) <= 25) ||
                    (txt === 'M' && Math.abs(clamped - 440) <= 35) ||
                    (txt === 'L' && clamped >= 500);
    pill.classList.toggle('active', isMatch);
  });
  if (!silent) {
    saveUiStateToStorage();
  }
}

function startInspectorResize(ev) {
  if (ev) ev.preventDefault();
  const insp = document.getElementById('pointInspector');
  if (!insp || insp.classList.contains('collapsed') || window.innerWidth <= 820) return;
  insp.classList.add('is-resizing');
  const startX = ev.clientX;
  const startWidth = insp.getBoundingClientRect().width || inspectorWidthPx || 380;

  function onMouseMove(moveEv) {
    const deltaX = startX - moveEv.clientX;
    const nextWidth = Math.max(280, Math.min(680, startWidth + deltaX));
    setInspectorWidthPreset(nextWidth, true);
  }

  function onMouseUp() {
    insp.classList.remove('is-resizing');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    saveUiStateToStorage();
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function pushInspectorUndoSnapshot(tab, actionLabel) {
  if (!tab) return;
  try {
    const snap = {
      tabId: tab.id,
      actionLabel: actionLabel || "Thay đổi cài đặt",
      selectedIndex: tab.selectedIndex || 0,
      start_addr: tab.start_addr,
      count: tab.count,
      tags: JSON.parse(JSON.stringify(tab.tags || {})),
      units: JSON.parse(JSON.stringify(tab.units || {})),
      scales: JSON.parse(JSON.stringify(tab.scales || {})),
      controls: JSON.parse(JSON.stringify(tab.controls || {})),
      disabled_addrs: Array.isArray(tab.disabled_addrs) ? [...tab.disabled_addrs] : Array.from(parseAddrRangeSet(tab.disabled_addrs)),
      read_only_addrs: Array.isArray(tab.read_only_addrs) ? [...tab.read_only_addrs] : Array.from(parseAddrRangeSet(tab.read_only_addrs)),
      writable_addrs: Array.isArray(tab.writable_addrs) ? [...tab.writable_addrs] : Array.from(parseAddrRangeSet(tab.writable_addrs))
    };
    inspectorUndoStack.push(snap);
    if (inspectorUndoStack.length > 35) inspectorUndoStack.shift();
    updateInspectorUndoButtons();
  } catch (e) {}
}

function updateInspectorUndoButtons() {
  const count = inspectorUndoStack.length;
  ['btnInspUndo', 'btnInspUndo2'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = (count === 0);
    btn.style.opacity = count === 0 ? '0.45' : '1';
    btn.innerHTML = id === 'btnInspUndo'
      ? `↩️ Back${count > 0 ? ` (${count})` : ''}`
      : `↩️ Hoàn tác${count > 0 ? ` (${count})` : ''}`;
  });
}

function undoLastInspectorChange() {
  if (inspectorUndoStack.length === 0) {
    showToast("Không còn bước thay đổi nào trước đó để hoàn tác.");
    return;
  }
  const snap = inspectorUndoStack.pop();
  const tab = sessionTabs.find(t => t.id === snap.tabId) || getActiveTab();
  if (!tab) return;
  tab.start_addr = snap.start_addr;
  tab.count = snap.count;
  tab.tags = snap.tags || {};
  tab.units = snap.units || {};
  tab.scales = snap.scales || {};
  tab.controls = snap.controls || {};
  tab.disabled_addrs = snap.disabled_addrs || [];
  tab.read_only_addrs = snap.read_only_addrs || [];
  tab.writable_addrs = snap.writable_addrs || [];
  tab.selectedIndex = snap.selectedIndex || 0;

  updateInspectorUndoButtons();
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  if (currentView === 'trend' && typeof renderTrendStudioView === 'function') renderTrendStudioView();
  saveUiStateToStorage();
  showToast(`↩️ Đã hoàn tác: ${snap.actionLabel}!`);
}

function onInspectorInputKeydown(ev, key, inputEl) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.stopPropagation();
    const val = key === 'scale' ? parseFloat(inputEl.value) : inputEl.value;
    savePointMeta(key, val, true);
    inputEl.blur();
  }
}

function onInspectorCtrlKeydown(ev, inputEl) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.stopPropagation();
    saveInspectorControlConfig(true);
    if (inputEl) inputEl.blur();
  }
}

function updateInspector() {
  const t = getActiveTab();
  if (!t) return;
  const idx = Math.min(Math.max(0, t.selectedIndex || 0), Math.max(0, t.count - 1));
  const addrDec = t.start_addr + idx;
  const plcPrefix = (t.fn_code === 3) ? 40001 : (t.fn_code === 4) ? 30001 : (t.fn_code === 1) ? 1 : 10001;
  const plcAddr = plcPrefix + addrDec;
  const rawVal = Array.isArray(t.values) ? t.values[idx] : undefined;
  const raw = (rawVal !== undefined && rawVal !== null) ? rawVal : 0;
  const rawTag = getPointMeta(t.tags, idx, t.start_addr, "");
  const unit = getPointMeta(t.units, idx, t.start_addr, "");
  const scale = getPointMeta(t.scales, idx, t.start_addr, 1.0);
  const isDisabled = isRegisterDisabled(t, idx);
  const isReadOnly = isRegisterReadOnly(t, idx);
  const valStr = isDisabled ? "CẤM ĐỌC" : formatValue(rawVal, t.format, scale);
  const updatedAtStr = (t.lastUpdatedMap && t.lastUpdatedMap[idx]) ? t.lastUpdatedMap[idx] : (t.lastUpdated || "--");

  const elTitle = document.getElementById('inspTitle');
  if (elTitle) elTitle.textContent = `Point Inspector #${plcAddr} (Addr: ${addrDec})`;
  const elHero = document.getElementById('inspHeroNum');
  if (elHero) elHero.textContent = valStr;
  const elUnit = document.getElementById('inspHeroUnit');
  if (elUnit) {
    elUnit.textContent = isDisabled
      ? `🚫 Đã khóa: Không gọi lệnh Modbus vào địa chỉ ${addrDec}`
      : `${unit ? 'Đơn vị: ' + unit + ' • ' : ''}Cập nhật: ${updatedAtStr}`;
  }

  const decBadge = document.getElementById('inspDecodedStateBadge');
  const decoded = decodeRegisterStateInfo(t, idx, rawVal);
  if (decBadge) {
    if (decoded && !isDisabled) {
      decBadge.style.display = 'block';
      decBadge.innerHTML = `<span class="decoded-state-pill tone-${decoded.tone}" style="font-size: 11px; padding: 3px 10px;">Trạng thái giải mã: ${escapeHtmlStr(decoded.badgeText)}</span>`;
    } else {
      decBadge.style.display = 'none';
      decBadge.innerHTML = '';
    }
  }

  const btnPin = document.getElementById('btnInspPinTrend');
  const isWatched = isPointWatchedInTrend(t.id, addrDec);
  if (btnPin) {
    btnPin.className = isWatched ? 'btn btn-primary' : 'btn btn-outline';
    btnPin.innerHTML = isWatched ? '📈 Đang Ghim Trên Thẻ Động (Bỏ Ghim)' : '📈 Ghim Thẻ Động &amp; Trend';
  }

  const inpAlias = document.getElementById('inpInspAlias');
  if (inpAlias && document.activeElement !== inpAlias) inpAlias.value = rawTag;
  const inpUnit = document.getElementById('inpInspUnit');
  if (inpUnit && document.activeElement !== inpUnit) inpUnit.value = unit;
  const inpScale = document.getElementById('inpInspScale');
  if (inpScale && document.activeElement !== inpScale) inpScale.value = scale;
  const inpWrite = document.getElementById('inpInspWriteVal');
  if (inpWrite && document.activeElement !== inpWrite) inpWrite.value = raw;

  const explicitCtrl = t.controls ? getPointMeta(t.controls, idx, t.start_addr, null) : null;
  const effectiveCtrl = getEffectiveControlConfig(t, idx);
  const selCtrl = document.getElementById('selInspCtrlType');
  const curCtrlType = isReadOnly ? 'readonly' : ((explicitCtrl && explicitCtrl.type) ? explicitCtrl.type : 'auto');
  if (selCtrl && document.activeElement !== selCtrl) {
    selCtrl.value = curCtrlType;
  }
  const showType = curCtrlType === 'auto' ? effectiveCtrl.type : curCtrlType;
  const boxToggle = document.getElementById('boxInspCtrlToggle');
  const boxStep = document.getElementById('boxInspCtrlStepper');
  const boxDrop = document.getElementById('boxInspCtrlDropdown');
  if (boxToggle) boxToggle.style.display = (showType === 'toggle') ? 'flex' : 'none';
  if (boxStep) boxStep.style.display = (showType === 'stepper') ? 'flex' : 'none';
  if (boxDrop) boxDrop.style.display = (showType === 'dropdown' || showType === 'buttons') ? 'flex' : 'none';

  const inpOn = document.getElementById('inpInspCtrlOnVal');
  if (inpOn && document.activeElement !== inpOn) inpOn.value = effectiveCtrl.onValue !== undefined ? effectiveCtrl.onValue : 1;
  const inpOff = document.getElementById('inpInspCtrlOffVal');
  if (inpOff && document.activeElement !== inpOff) inpOff.value = effectiveCtrl.offValue !== undefined ? effectiveCtrl.offValue : 0;
  const inpStep = document.getElementById('inpInspCtrlStep');
  if (inpStep && document.activeElement !== inpStep) inpStep.value = effectiveCtrl.step !== undefined ? effectiveCtrl.step : 1;
  const inpMin = document.getElementById('inpInspCtrlMin');
  if (inpMin && document.activeElement !== inpMin) inpMin.value = effectiveCtrl.min !== undefined ? effectiveCtrl.min : 0;
  const inpMax = document.getElementById('inpInspCtrlMax');
  if (inpMax && document.activeElement !== inpMax) inpMax.value = effectiveCtrl.max !== undefined ? effectiveCtrl.max : 65535;
  const inpOpts = document.getElementById('inpInspCtrlOptions');
  if (inpOpts && document.activeElement !== inpOpts) {
    inpOpts.value = formatMultistateOptionsSpec(effectiveCtrl.options || [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }, { value: 2, label: 'Toggle' }]);
  }

  const btnDis = document.getElementById('btnInspToggleDisable');
  if (btnDis) {
    if (isDisabled) {
      btnDis.className = "btn btn-rose";
      btnDis.textContent = `🚫 Đang Cấm Đọc`;
    } else {
      btnDis.className = "btn btn-emerald";
      btnDis.textContent = `☑ Cho Phép Đọc`;
    }
  }

  const btnLock = document.getElementById('btnInspToggleWriteLock');
  if (btnLock) {
    if (isReadOnly) {
      btnLock.className = "btn btn-outline";
      btnLock.style.color = "var(--amber)";
      btnLock.style.borderColor = "rgba(245,158,11,0.45)";
      btnLock.textContent = `🔒 Đang Cấm Ghi`;
    } else {
      btnLock.className = "btn btn-outline";
      btnLock.style.color = "var(--emerald)";
      btnLock.style.borderColor = "rgba(16,185,129,0.45)";
      btnLock.textContent = `🔓 Cho Phép Ghi`;
    }
  }

  const u16 = raw & 0xFFFF;
  const i16 = u16 > 32767 ? u16 - 65536 : u16;
  const mU16 = document.getElementById('matUint16');
  if (mU16) mU16.textContent = u16;
  const mI16 = document.getElementById('matInt16');
  if (mI16) mI16.textContent = i16;
  const mHex = document.getElementById('matHex');
  if (mHex) mHex.textContent = "0x" + u16.toString(16).toUpperCase().padStart(4, "0");
  const mBin = document.getElementById('matBin');
  if (mBin) mBin.textContent = u16.toString(2).padStart(16, "0").replace(/(\d{4})/g, "$1 ").trim();
  const mFA = document.getElementById('matFloatABCD');
  if (mFA) mFA.textContent = (raw * scale).toFixed(2);
  const mFC = document.getElementById('matFloatCDAB');
  if (mFC) mFC.textContent = (raw * scale).toFixed(2);
  updateInspectorUndoButtons();
}

function savePointMeta(key, val, showConfirmToast) {
  const t = getActiveTab();
  if (!t) return;
  const idx = t.selectedIndex || 0;
  const addrDec = t.start_addr + idx;
  const curVal = key === 'alias'
    ? getPointMeta(t.tags, idx, t.start_addr, "")
    : key === 'unit'
      ? getPointMeta(t.units, idx, t.start_addr, "")
      : getPointMeta(t.scales, idx, t.start_addr, 1.0);
  if (String(curVal) !== String(val)) {
    pushInspectorUndoSnapshot(t, `Sửa ${key === 'alias' ? 'Tên Tag' : key === 'unit' ? 'Đơn vị' : 'Hệ số'} #${addrDec}`);
  }
  if (key === 'alias') setPointMeta(t.tags, idx, t.start_addr, val);
  if (key === 'unit') setPointMeta(t.units, idx, t.start_addr, val);
  if (key === 'scale') setPointMeta(t.scales, idx, t.start_addr, isNaN(val) ? 1.0 : val);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
  saveUiStateToStorage();
  if (showConfirmToast) {
    showToast(`✔ Đã lưu ${key === 'alias' ? 'Tên Tag' : key === 'unit' ? 'Đơn vị' : 'Hệ số'} tại địa chỉ ${addrDec} (Nhấn ↩️ Back nếu muốn hoàn tác)!`);
  }
}

function submitInspectorWrite() {
  const t = getActiveTab();
  const idx = t.selectedIndex || 0;
  const addrDec = t.start_addr + idx;
  if (isRegisterReadOnly(t, idx)) {
    showToast(`🔒 Địa chỉ ${addrDec} đang bật Cấm Ghi Mềm! Hãy nhấn '🔒 Đang Cấm Ghi' để mở khóa trước.`);
    return;
  }
  const val = parseInt(document.getElementById('inpInspWriteVal').value) || 0;
  const fn = (t.fn_code === 1 || t.fn_code === 2) ? 5 : 6;
  doModbusWrite(t.port, t.baud, t.parity || 'N', t.stopbits || 1, t.slave_id, fn, addrDec, val);
}

function spawn8ComTabs() {
  sessionTabs.forEach(t => { if (t.isPolling && t.timer) clearInterval(t.timer); });
  sessionTabs = [];
  for (let i = 0; i < 8; i++) {
    sessionTabs.push({
      id: `tab_com_${i + 1}`,
      name: `COM ${i + 1}`,
      port: `/dev/ttyCH${i}`,
      baud: globalSerial.baud || 9600,
      parity: globalSerial.parity || "N",
      stopbits: globalSerial.stopbits || 1,
      slave_id: 1,
      fn_code: 3,
      start_addr: 0,
      count: 10,
      disabled_addrs: [],
      read_only_addrs: [],
      writable_addrs: [],
      only_tagged: false,
      format: "uint16",
      scan_ms: 1000,
      isPolling: false,
      timer: null,
      values: [],
      rawHexs: [],
      lastPollState: "idle",
      lastError: "",
      blockErrors: [],
      tags: {},
      units: {},
      scales: {},
      selectedIndex: 0
    });
  }
  activeTabId = sessionTabs[0].id;
  renderTabs();
  const t = getActiveTab();
  updateHeaderSerialBadge(t.port, t.baud, t.parity, t.stopbits);
}

function toggleAllTabsPolling() {
  const anyRunning = sessionTabs.some(t => t.isPolling);
  if (anyRunning) {
    sessionTabs.forEach(t => {
      if (t.timer) clearInterval(t.timer);
      t.timer = null;
      t.isPolling = false;
    });
  } else {
    sessionTabs.forEach((t, idx) => {
      t.isPolling = true;
      setTimeout(() => {
        if (t.isPolling) {
          executePoll(t);
          t.timer = setInterval(() => executePoll(t), t.scan_ms);
        }
      }, idx * 45);
    });
  }
  renderTabs(true);
}

// ==================== POLLING ENGINE (SMART CONTIGUOUS SUB-BLOCKS + IN-PLACE DOM PATCH) ====================
async function executePoll(tab) {
  const pTag = shortPortLabel(tab.port);
  const disArr = Array.from(parseAddrRangeSet(tab.disabled_addrs)).sort((a, b) => a - b);
  try {
    const res = await fetch('/api/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: tab.port,
        baud: tab.baud,
        parity: tab.parity || 'N',
        stopbits: tab.stopbits || 1,
        slave_id: tab.slave_id,
        fn_code: tab.fn_code,
        start_addr: tab.start_addr,
        count: tab.count,
        disabled_addrs: disArr,
        only_tagged: Boolean(tab.only_tagged),
        tags: tab.only_tagged ? tab.tags : undefined
      })
    });
    const data = await res.json();
    if (data.success) {
      const nowTime = new Date();
      const nowStr = nowTime.toTimeString().split(' ')[0];
      tab.values = data.values || [];
      tab.rawHexs = tab.values.map(v => (v !== null && v !== undefined) ? ("0x" + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")) : "--");
      tab.lastUpdated = nowStr;
      if (!tab.lastUpdatedMap) tab.lastUpdatedMap = {};
      tab.values.forEach((v, idx) => {
        if (v !== null && v !== undefined) {
          tab.lastUpdatedMap[idx] = nowStr;
        }
      });
      tab.lastPollState = 'ok';
      tab.lastError = '';
      tab.blockErrors = data.block_errors || [];

      const blkTxt = (data.sub_blocks_total && data.sub_blocks_total > 1) ? ` • ${data.sub_blocks_ok}/${data.sub_blocks_total} khối` : '';
      const latEl = document.getElementById('badgeLatency');
      if (latEl) latEl.textContent = `Độ trễ (${pTag}): ${data.latency_ms} ms${blkTxt}`;

      if (data.tx_hex && data.rx_hex) {
        appendTrafficLog('TX', data.tx_hex, 0, pTag);
        appendTrafficLog('RX', data.rx_hex, data.latency_ms, pTag);
      }

      try {
        if (typeof ingestPollIntoTrendStudio === 'function') {
          ingestPollIntoTrendStudio(tab, nowStr);
        }
      } catch (trendErr) {
        console.error("ingestPollIntoTrendStudio error:", trendErr);
      }

      if (tab.id === activeTabId) {
        try { updateTableLiveValuesInPlace(tab); } catch (uiErr) { console.error("updateTableLiveValuesInPlace error:", uiErr); }
        try { updateInspector(); } catch (uiErr) { console.error("updateInspector error:", uiErr); }
      }
      if (currentView === 'trend') {
        if (typeof updateTrendCardsLiveValuesInPlace === 'function') {
          try { updateTrendCardsLiveValuesInPlace(); } catch (uiErr) {}
        } else if (typeof renderTrendStudioView === 'function') {
          try { renderTrendStudioView(); } catch (uiErr) {}
        }
      }
    } else {
      tab.lastPollState = 'error';
      tab.lastError = data.error || 'Timeout';
      tab.blockErrors = data.block_errors || [];
      if (tab.id === activeTabId) {
        const latEl = document.getElementById('badgeLatency');
        if (latEl) latEl.textContent = `Lỗi (${pTag}): ${data.error || 'Timeout'}`;
        try { updateTableLiveValuesInPlace(tab); } catch (uiErr) {}
      }
      appendTrafficLog('ERR', data.error || 'Lỗi Polling', 0, pTag);
    }
  } catch (err) {
    tab.lastPollState = 'error';
    tab.lastError = 'Mất kết nối API';
    const latEl = document.getElementById('badgeLatency');
    if (latEl) latEl.textContent = `Mất kết nối`;
  }
}

function togglePolling() {
  const t = getActiveTab();
  t.isPolling = !t.isPolling;
  if (t.isPolling) {
    executePoll(t);
    t.timer = setInterval(() => executePoll(t), t.scan_ms);
  } else {
    clearInterval(t.timer);
    t.timer = null;
  }
  renderTabs(true);
}

function pollOnce() {
  const t = getActiveTab();
  executePoll(t);
}

// ==================== MODBUS WRITE ====================
function openQuickWriteModal(addr, defaultVal) {
  const t = getActiveTab();
  document.getElementById('writeModal').classList.add('open');
  document.getElementById('modalWriteFn').value = (t.fn_code === 1 || t.fn_code === 2) ? 5 : 6;
  document.getElementById('modalWriteAddr').value = addr !== undefined ? addr : t.start_addr;
  document.getElementById('modalWriteVal').value = defaultVal !== undefined ? defaultVal : 0;
}

function closeWriteModal() {
  document.getElementById('writeModal').classList.remove('open');
}

async function submitModalWrite() {
  const t = getActiveTab();
  const fn = parseInt(document.getElementById('modalWriteFn').value);
  const addr = parseInt(document.getElementById('modalWriteAddr').value);
  const val = parseInt(document.getElementById('modalWriteVal').value);
  closeWriteModal();
  await doModbusWrite(t.port, t.baud, t.parity || 'N', t.stopbits || 1, t.slave_id, fn, addr, val);
}

async function doModbusWrite(port, baud, parity, stopbits, slave_id, fn, addr, val) {
  try {
    const res = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: port,
        baud: baud,
        parity: parity,
        stopbits: stopbits,
        slave_id: slave_id,
        fn_code: fn,
        address: addr,
        value: val
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.tx_hex && data.rx_hex) {
        appendTrafficLog('TX', data.tx_hex);
        appendTrafficLog('RX', data.rx_hex, data.latency_ms);
      }
      showToast(`Đã ghi thành công giá trị ${val} vào địa chỉ ${addr}!`);
      pollOnce();
    } else {
      alert("Lỗi ghi Modbus: " + (data.error || "Thất bại"));
    }
  } catch (err) {
    alert("Lỗi mạng khi ghi: " + err);
  }
}

// ==================== TRAFFIC DRAWER ====================
let trafficEntriesCount = 0;
function toggleTrafficDrawer() {
  document.getElementById('trafficDrawer').classList.toggle('minimized');
}

function appendTrafficLog(dir, hexStr, latency, portLabel) {
  const list = document.getElementById('trafficLogList');
  if (!list) return;
  trafficEntriesCount++;
  const badge = document.getElementById('trafficCountBadge');
  if (badge) badge.textContent = `${trafficEntriesCount} Gói Tin`;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const line = document.createElement('div');
  line.className = 'traffic-line';
  let tagClass = (dir === 'TX') ? 'traffic-tag-tx' : (dir === 'RX') ? 'traffic-tag-rx' : 'traffic-tag-err';
  let latStr = latency ? ` (${latency}ms)` : '';
  let portBadge = portLabel ? `<span style="color: #94a3b8; font-weight: 600;">[${portLabel}]</span>` : '';

  line.innerHTML = `
    <span class="traffic-time">[${timeStr}]</span>
    ${portBadge}
    <span class="${tagClass}">[${dir}]</span>
    <span class="traffic-hex">${hexStr}${latStr}</span>
  `;
  list.appendChild(line);

  const chkAuto = document.getElementById('chkAutoScroll');
  if (chkAuto && chkAuto.checked) {
    list.scrollTop = list.scrollHeight;
  }
  if (list.children.length > 250) {
    list.removeChild(list.children[0]);
  }
}

function clearTrafficLog() {
  const list = document.getElementById('trafficLogList');
  if (list) list.innerHTML = '';
  trafficEntriesCount = 0;
  const badge = document.getElementById('trafficCountBadge');
  if (badge) badge.textContent = `0 Gói Tin`;
}

function copyTrafficLog() {
  const text = document.getElementById('trafficLogList')?.innerText || '';
  navigator.clipboard.writeText(text);
  showToast("Đã sao chép toàn bộ Frame Log vào Clipboard!");
}
