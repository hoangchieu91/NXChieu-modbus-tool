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

// Mobile Native App State
let isMobileCardView = (typeof window !== 'undefined' && window.innerWidth <= 820);
let isMobileConfigCollapsed = false;

function showToast(msg) {
  const b = document.getElementById('toastBanner');
  const t = document.getElementById('toastText');
  if (!b || !t) return;
  t.textContent = msg;
  b.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => b.classList.remove('show'), 3800);
}

// ==================== MOBILE NATIVE APP NAVIGATION & HELPERS ====================
function toggleMobileSidebar(forceState) {
  const sb = document.querySelector('aside.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (!sb) return;
  const nextState = (typeof forceState === 'boolean') ? forceState : !sb.classList.contains('mobile-open');
  sb.classList.toggle('mobile-open', nextState);
  if (bd) bd.classList.toggle('open', nextState);
}

function toggleMobileConfigCollapse() {
  const toolbar = document.getElementById('pollConfigToolbar');
  const btn = document.getElementById('btnMobileToggleCfg');
  if (!toolbar) return;
  isMobileConfigCollapsed = !isMobileConfigCollapsed;
  toolbar.classList.toggle('mobile-collapsed', isMobileConfigCollapsed);
  if (btn) {
    btn.innerHTML = isMobileConfigCollapsed
      ? '⚙️ Mở Cấu Hình Cổng & Địa Chỉ ▾'
      : '⚙️ Thu Gọn Cấu Hình ▴';
  }
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

function shortPortLabel(port) {
  if (!port) return "--";
  if (port === "ALL") return "8 CỔNG COM";
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
  allPortSelects.forEach(sel => {
    if (!sel) return;
    const allowAll = sel.classList.contains('js-allow-all-ports') && extCount > 1;
    const prev = sel.value;
    const validIds = new Set(availablePortsCache.map(p => p.id));
    if (allowAll) validIds.add('ALL');
    const cur = validIds.has(prev) ? prev : globalSerial.port;

    let html = '';
    if (allowAll) {
      html += `<option value="ALL" ${cur === 'ALL' ? 'selected' : ''}>⚡ TẤT CẢ ${extCount} CỔNG COM (Quét Song Song COM 1→${extCount})</option>`;
    }
    html += availablePortsCache.map(p =>
      `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${p.label}</option>`
    ).join('');
    sel.innerHTML = html;
  });
}

function updateHeaderSerialBadge(port, baud, parity, stopbits) {
  const p = parity || 'N';
  const s = stopbits || 1;
  const shortP = shortPortLabel(port);
  const text = (port && port.startsWith('/dev/ttyCH'))
    ? `${shortP} (${port.replace('/dev/', '')}) • ${baud} 8${p}${s}`
    : `${port} • ${baud} 8${p}${s}`;
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

  document.querySelectorAll('.js-port-select').forEach(s => { if (s.value !== 'ALL') s.value = port; });
  document.querySelectorAll('.js-baud-select').forEach(s => { s.value = String(baud); });
  const fVal = `${parity}-${stopbits}`;
  ['selScanRangeFraming', 'selSpecFraming', 'selGwFraming'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = fVal;
  });

  pushSerialConfigToBackend(port, baud, parity, stopbits);
  renderTabs();
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
function showView(viewId) {
  currentView = viewId;
  toggleMobileSidebar(false);

  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const pollView = document.getElementById('view-poll');
  if (pollView) {
    if (viewId === 'poll') {
      pollView.style.display = 'flex';
    } else {
      pollView.style.display = 'none';
      const target = document.getElementById(`view-${viewId}`);
      if (target) target.classList.add('active');
    }
  }

  document.querySelectorAll('.sidebar .nav-btn').forEach(b => {
    b.classList.remove('active');
    const oc = b.getAttribute('onclick') || '';
    if (oc.includes(`'${viewId}'`)) b.classList.add('active');
  });

  document.querySelectorAll('.mobile-bottom-nav .mob-nav-item').forEach(b => {
    const targetV = b.getAttribute('data-view');
    b.classList.toggle('active', targetV === viewId);
  });

  if (viewId === 'scanner' && typeof renderScannerGrid === 'function') renderScannerGrid();
  if (viewId === 'datalog' && typeof loadSessions === 'function') loadSessions();
  if (viewId === 'trend' && typeof initTrendCanvas === 'function') initTrendCanvas();
  if (viewId === 'aidoc' && typeof renderAiTemplatePreview === 'function') renderAiTemplatePreview(0);
  if (viewId === 'profiles' && typeof loadSdProfileStudio === 'function') loadSdProfileStudio(false);
}

function switchSdInspectorTab(tabKey) {
  ['visual', 'matrix', 'json'].forEach(k => {
    const b = document.getElementById(`btnSdInspTab_${k}`);
    const p = document.getElementById(`sdInspPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
}

function switchScannerTab(tabKey) {
  ['range', 'autobaud', 'special', 'regmap'].forEach(k => {
    const b = document.getElementById(`btnScanTab_${k}`);
    const p = document.getElementById(`scanPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  const shared = document.getElementById('sharedDeviceScanResults');
  if (shared) shared.style.display = (tabKey === 'regmap') ? 'none' : 'block';
}

function switchGatewayTab(tabKey) {
  ['multi', 'smart', 'com2com', 'ctrl', 'net'].forEach(k => {
    const b = document.getElementById(`btnGwTab_${k}`);
    const p = document.getElementById(`gwPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
}

function switchAiDocTab(tabKey) {
  ['schema', 'templates', 'prompt', 'api'].forEach(k => {
    const b = document.getElementById(`btnAiTab_${k}`);
    const p = document.getElementById(`aiPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  if (tabKey === 'templates' && typeof renderAiTemplatePreview === 'function') renderAiTemplatePreview(0);
}

function switchDatalogTab(tabKey) {
  ['cfg', 'files'].forEach(k => {
    const b = document.getElementById(`btnLogTab_${k}`);
    const p = document.getElementById(`logPane_${k}`);
    if (b) b.classList.toggle('active', k === tabKey);
    if (p) p.classList.toggle('active', k === tabKey);
  });
  if (tabKey === 'files' && typeof loadSessions === 'function') loadSessions();
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
}

function toggleInspectorPointDisabled() {
  const t = getActiveTab();
  const idx = t.selectedIndex || 0;
  toggleAddrDisabled(t.start_addr + idx);
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
function renderTabs() {
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
  renderTable();
  updateInspector();
}

function selectSessionTab(tabId) {
  activeTabId = tabId;
  renderTabs();
  const t = getActiveTab();
  updateHeaderSerialBadge(t.port, t.baud, t.parity || 'N', t.stopbits || 1);
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
}

function renameSessionTab(tabId) {
  const tab = sessionTabs.find(t => t.id === tabId);
  if (!tab) return;
  const newName = prompt("Nhập tên phiên đo mới:", tab.name);
  if (newName && newName.trim()) {
    tab.name = newName.trim();
    renderTabs();
  }
}

function syncToolbarWithActiveTab() {
  const t = getActiveTab();
  if (!t) return;
  const selP = document.getElementById('selPort');
  if (selP) selP.value = t.port;
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
  if (disInput) {
    disInput.value = formatAddrRangeString(parseAddrRangeSet(t.disabled_addrs));
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
    badgeSub.title = `Các khối lệnh thực tế gửi xuống RS485: [${rangeDesc || 'Không có'}]`;
  }

  // Mobile quick summary badge
  const mobSum = document.getElementById('lblMobileQuickTabSummary');
  if (mobSum) {
    mobSum.textContent = `${shortPortLabel(t.port)} • ${t.baud} 8${t.parity || 'N'}${t.stopbits || 1} • ID ${t.slave_id} • Addr ${t.start_addr}..${t.start_addr + t.count - 1}`;
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
}

// ==================== DATA FORMATTERS ====================
function formatValue(raw, format, scale) {
  if (raw === undefined || raw === null) return "--";
  scale = (scale !== undefined && scale !== null) ? scale : 1.0;
  const s = (typeof raw === 'number') ? raw : parseInt(raw);
  if (isNaN(s)) return "--";

  switch (format) {
    case "int16": {
      const v = s > 32767 ? s - 65536 : s;
      return (v * scale).toFixed(scale !== 1.0 ? 2 : 0);
    }
    case "hex":
      return "0x" + (s & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    case "binary":
      return (s & 0xFFFF).toString(2).padStart(16, "0").replace(/(\d{4})/g, "$1 ").trim();
    case "float_abcd":
    case "float_cdab":
      return (s * scale).toFixed(2);
    case "uint16":
    default:
      return (s * scale).toFixed(scale !== 1.0 ? 2 : 0);
  }
}

// ==================== TABLE & MOBILE CARD RENDERING ====================
function renderTable() {
  const t = getActiveTab();
  const tbody = document.getElementById('tblRegisters');
  const cardsBox = document.getElementById('mobileRegisterCards');
  if (!tbody || !t) return;
  tbody.innerHTML = '';
  if (cardsBox) cardsBox.innerHTML = '';

  const hideDisabled = document.getElementById('chkHideDisabled') && document.getElementById('chkHideDisabled').checked;
  const errAddrSet = new Set();
  (t.blockErrors || []).forEach(be => {
    for (let a = be.start_addr; a < be.start_addr + be.count; a++) errAddrSet.add(a);
  });

  let renderedRows = 0;
  const cardItemsHtml = [];

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
    const valStr = isDisabled ? "BỎ QUA" : formatValue(raw, t.format, scale);

    let statusHtml = '';
    if (isDisabled) {
      statusHtml = `<span class="badge badge-slate" style="color: var(--amber); border-color: rgba(245,158,11,0.35);" title="Thanh ghi này đã được khóa — Không gửi lệnh Modbus tới địa chỉ ${addrDec}">🚫 CẤM ĐỌC</span>`;
    } else if (hasVal) {
      statusHtml = `<span class="badge badge-emerald">✔ OK</span>`;
    } else if (errAddrSet.has(addrDec)) {
      statusHtml = `<span class="badge badge-rose" title="Khối chứa thanh ghi này trả về lỗi Modbus Exception">❌ LỖI KHỐI</span>`;
    } else if (t.lastPollState === 'error') {
      statusHtml = `<span class="badge badge-rose" title="${t.lastError || 'Timeout'}">⚠️ TIMEOUT</span>`;
    } else {
      statusHtml = `<span class="badge badge-slate">⏳ CHỜ ĐỌC</span>`;
    }

    const tr = document.createElement('tr');
    const classes = [];
    if (i === t.selectedIndex) classes.push("selected");
    if (isDisabled) classes.push("row-disabled");
    tr.className = classes.join(" ");
    tr.onclick = () => selectRow(i, false);
    tr.ondblclick = () => openQuickWriteModal(addrDec, hasVal ? raw : 0);

    tr.innerHTML = `
      <td style="text-align: center;" onclick="toggleAddrDisabled(${addrDec}, event)" title="Tích chọn để Đọc thanh ghi ${addrDec}, bỏ tích để Cấm Đọc (tách khối né địa chỉ ${addrDec})">
        <input type="checkbox" ${!isDisabled ? 'checked' : ''} style="cursor: pointer; accent-color: var(--emerald);">
      </td>
      <td style="color: #64748b;">${i + 1}</td>
      <td style="color: var(--cyan); font-weight: 700;">${addrDec}</td>
      <td style="color: #94a3b8;">${addrHex}</td>
      <td style="color: #cbd5e1; font-weight: 600;">${plcAddr}</td>
      <td style="color: ${rawTag ? '#f1f5f9' : '#64748b'}; font-weight: ${rawTag ? '600' : '400'};">${tag}</td>
      <td class="cell-value" title="Nhấp đúp để ghi giá trị">${valStr}</td>
      <td style="color: var(--text-muted);">${unit}</td>
      <td style="color: #64748b;">${scale}</td>
      <td style="color: #94a3b8;">${rawHex}</td>
      <td>${statusHtml}</td>
      <td>
        <button class="btn btn-outline" style="padding: 2px 6px; font-size: 11px;" onclick="openQuickWriteModal(${addrDec}, ${hasVal ? raw : 0}); event.stopPropagation();">Ghi</button>
      </td>
    `;
    tbody.appendChild(tr);

    // Build Native Mobile Card HTML
    if (cardsBox) {
      cardItemsHtml.push(`
        <div class="mobile-reg-card ${isDisabled ? 'is-disabled' : ''} ${i === t.selectedIndex ? 'selected' : ''}" onclick="selectRow(${i}, true)">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="checkbox" ${!isDisabled ? 'checked' : ''} onclick="toggleAddrDisabled(${addrDec}, event)" style="width: 17px; height: 17px; accent-color: var(--emerald); cursor: pointer;">
              <span class="badge badge-cyan" style="font-family: monospace; font-size: 11px;">Addr ${addrDec} (${addrHex})</span>
              <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">#${plcAddr}</span>
            </div>
            ${statusHtml}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 2px;">
            <div style="font-weight: 700; font-size: 14px; color: ${rawTag ? '#fff' : '#94a3b8'}; line-height: 1.3; word-break: break-word;">
              ${tag}
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <span class="mrc-val">${valStr}</span>
              ${unit ? `<span style="font-size: 12px; color: var(--cyan); font-weight: 700; margin-left: 3px;">${unit}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); border-top: 1px dashed rgba(255,255,255,0.07); padding-top: 6px; margin-top: 2px;">
            <span style="font-family: monospace;">RAW: ${rawHex} • Hệ số: ×${scale}</span>
            <div style="display: flex; gap: 6px;" onclick="event.stopPropagation();">
              <button class="btn btn-outline" style="padding: 3px 9px; font-size: 11px;" onclick="toggleAddrDisabled(${addrDec}, event)">
                ${isDisabled ? '☑ Mở Đọc' : '🚫 Cấm Đọc'}
              </button>
              <button class="btn btn-primary" style="padding: 3px 10px; font-size: 11px;" onclick="openQuickWriteModal(${addrDec}, ${hasVal ? raw : 0})">
                ✏️ Ghi
              </button>
            </div>
          </div>
        </div>
      `);
    }
  }

  if (renderedRows === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">Tất cả các dòng trong Tab này đang bị ẩn do bộ lọc 'Ẩn dòng Cấm Đọc'. Bỏ tích 'Ẩn dòng Cấm Đọc' để xem lại.</td></tr>`;
    if (cardsBox) {
      cardsBox.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px;">Đang ẩn các dòng Cấm Đọc.</div>`;
    }
  } else if (cardsBox) {
    cardsBox.innerHTML = cardItemsHtml.join('');
  }
}

function selectRow(idx, openInspectorOnMobile) {
  const t = getActiveTab();
  t.selectedIndex = idx;
  renderTable();
  updateInspector();
  if (openInspectorOnMobile && window.innerWidth <= 820) {
    const insp = document.getElementById('pointInspector');
    if (insp) insp.classList.remove('collapsed');
  }
}

// ==================== POINT INSPECTOR ====================
function toggleInspector() {
  const insp = document.getElementById('pointInspector');
  if (insp) insp.classList.toggle('collapsed');
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
  const tag = getPointMeta(t.tags, idx, t.start_addr, "") || `Điểm #${addrDec}`;
  const unit = getPointMeta(t.units, idx, t.start_addr, "");
  const scale = getPointMeta(t.scales, idx, t.start_addr, 1.0);
  const isDisabled = isRegisterDisabled(t, idx);
  const valStr = isDisabled ? "CẤM ĐỌC" : formatValue(rawVal, t.format, scale);

  const elTitle = document.getElementById('inspTitle');
  if (elTitle) elTitle.textContent = `Point Inspector #${plcAddr} (Addr: ${addrDec})`;
  const elHero = document.getElementById('inspHeroNum');
  if (elHero) elHero.textContent = valStr;
  const elUnit = document.getElementById('inspHeroUnit');
  if (elUnit) {
    elUnit.textContent = isDisabled
      ? `🚫 Đã khóa: Không gọi lệnh Modbus vào địa chỉ ${addrDec}`
      : (unit ? `Đơn vị: ${unit}` : "--");
  }
  const inpAlias = document.getElementById('inpInspAlias');
  if (inpAlias) inpAlias.value = tag;
  const inpUnit = document.getElementById('inpInspUnit');
  if (inpUnit) inpUnit.value = unit;
  const inpScale = document.getElementById('inpInspScale');
  if (inpScale) inpScale.value = scale;
  const inpWrite = document.getElementById('inpInspWriteVal');
  if (inpWrite) inpWrite.value = raw;

  const btnDis = document.getElementById('btnInspToggleDisable');
  if (btnDis) {
    if (isDisabled) {
      btnDis.className = "btn btn-rose";
      btnDis.textContent = `🚫 Đang Cấm Đọc (Nhấn để Mở lại)`;
    } else {
      btnDis.className = "btn btn-emerald";
      btnDis.textContent = `☑ Đang Cho Phép Đọc (Nhấn để Cấm)`;
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
}

function savePointMeta(key, val) {
  const t = getActiveTab();
  const idx = t.selectedIndex || 0;
  if (key === 'alias') setPointMeta(t.tags, idx, t.start_addr, val);
  if (key === 'unit') setPointMeta(t.units, idx, t.start_addr, val);
  if (key === 'scale') setPointMeta(t.scales, idx, t.start_addr, val);
  syncToolbarWithActiveTab();
  renderTable();
  updateInspector();
}

function submitInspectorWrite() {
  const t = getActiveTab();
  const idx = t.selectedIndex || 0;
  const addrDec = t.start_addr + idx;
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
  renderTabs();
}

// ==================== POLLING ENGINE (SMART CONTIGUOUS SUB-BLOCKS) ====================
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
      tab.values = data.values || [];
      tab.rawHexs = tab.values.map(v => (v !== null && v !== undefined) ? ("0x" + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")) : "--");
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

      if (tab.id === activeTabId) {
        renderTable();
        updateInspector();
        if (typeof pushTrendRecord === 'function') pushTrendRecord(tab.values.map(v => v || 0));
      }
    } else {
      tab.lastPollState = 'error';
      tab.lastError = data.error || 'Timeout';
      tab.blockErrors = data.block_errors || [];
      if (tab.id === activeTabId) {
        const latEl = document.getElementById('badgeLatency');
        if (latEl) latEl.textContent = `Lỗi (${pTag}): ${data.error || 'Timeout'}`;
        renderTable();
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
  renderTabs();
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
