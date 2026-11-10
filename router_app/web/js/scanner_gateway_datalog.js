// ============================================================================
// NXChieu Modbus Studio Pro v3.3 — Scanner, Gateway, Datalogger & Hardware Status
// File: router_app/web/js/scanner_gateway_datalog.js
// ============================================================================

let lastScanResults = [];

function renderScannerGrid(customFrom, customTo) {
  const grid = document.getElementById('scannerGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const fromId = customFrom || parseInt(document.getElementById('inpScanFrom')?.value) || 1;
  const toId = customTo || parseInt(document.getElementById('inpScanTo')?.value) || 16;
  for (let i = fromId; i <= toId; i++) {
    const tile = document.createElement('div');
    tile.className = 'slave-tile';
    tile.id = `slave-tile-${i}`;
    tile.innerHTML = `ID ${i}`;
    grid.appendChild(tile);
  }
}

function toggleAllBaudChecks(selectAll) {
  const defaults = new Set([2400, 4800, 9600, 19200, 38400, 57600, 115200]);
  document.querySelectorAll('.chk-baud').forEach(chk => {
    chk.checked = selectAll ? true : defaults.has(parseInt(chk.value));
  });
}

function setSpecialPreset(fn, addr, qty) {
  document.getElementById('selScanFn').value = String(fn);
  document.getElementById('inpScanAddr').value = String(addr);
  document.getElementById('inpScanQty').value = String(qty);
}

async function runScannerMode(mode) {
  let port = globalSerial.port;
  let baud = globalSerial.baud;
  let parity = 'N';
  let stopbits = 1;
  let autoBaud = false;
  let autoParity = false;
  let selectedBauds = [];
  let fromId = 1, toId = 16;
  let fnCode = 3, testAddr = 0, quantity = 1, timeoutMs = 120;
  let btn = null, btnOrigHtml = "";

  if (mode === 'range') {
    port = document.getElementById('selScanRangePort').value || port;
    baud = parseInt(document.getElementById('selScanRangeBaud').value) || 9600;
    const fp = (document.getElementById('selScanRangeFraming').value || 'N-1').split('-');
    parity = fp[0]; stopbits = parseInt(fp[1]) || 1;
    fromId = parseInt(document.getElementById('inpScanFrom').value) || 1;
    toId = parseInt(document.getElementById('inpScanTo').value) || 16;
    timeoutMs = parseInt(document.getElementById('selScanRangeTimeout').value) || 120;
    btn = document.getElementById('btnStartScanRange');
    btnOrigHtml = '🔍 Bắt Đầu Quét Dải ID';
  } else if (mode === 'autobaud') {
    port = document.getElementById('selAutoBaudPort').value || port;
    fromId = parseInt(document.getElementById('inpAutoFrom').value) || 1;
    toId = parseInt(document.getElementById('inpAutoTo').value) || 3;
    autoBaud = true;
    autoParity = (document.getElementById('selAutoParityMode').value === 'full');
    timeoutMs = parseInt(document.getElementById('selAutoTimeout').value) || 80;
    document.querySelectorAll('.chk-baud:checked').forEach(c => selectedBauds.push(parseInt(c.value)));
    if (selectedBauds.length === 0) selectedBauds = [9600, 19200, 38400, 115200];
    btn = document.getElementById('btnStartScanAuto');
    btnOrigHtml = '⚡ Tự Động Dò Tốc Độ & Cấu Hình';
  } else if (mode === 'special') {
    port = document.getElementById('selSpecPort').value || port;
    baud = parseInt(document.getElementById('selSpecBaud').value) || 9600;
    const fp = (document.getElementById('selSpecFraming').value || 'N-1').split('-');
    parity = fp[0]; stopbits = parseInt(fp[1]) || 1;
    fnCode = parseInt(document.getElementById('selScanFn').value) || 3;
    testAddr = parseInt(document.getElementById('inpScanAddr').value) || 0;
    quantity = parseInt(document.getElementById('inpScanQty').value) || 1;
    fromId = parseInt(document.getElementById('inpSpecFrom').value) || 1;
    toId = parseInt(document.getElementById('inpSpecTo').value) || 16;
    btn = document.getElementById('btnStartScanSpec');
    btnOrigHtml = '🎯 Dò Theo Thanh Ghi Đặc Biệt';
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Đang Quét...`;
  }

  const isScanAll = (port === 'ALL');
  renderScannerGrid(fromId, toId);
  document.getElementById('lblScanStatus').textContent =
    `Đang dò ${isScanAll ? 'SONG SONG TẤT CẢ CỔNG COM' : shortPortLabel(port)} từ ID ${fromId} → ${toId} (${autoBaud ? selectedBauds.join(', ') + ' bps' : baud + ' 8' + parity + stopbits}, FC0${fnCode} Addr ${testAddr})...`;

  const tbody = document.getElementById('tblDiscoveredDevices');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--cyan); padding: 14px;"><span class="pulse-dot"></span> Đang gửi khung thăm dò ${isScanAll ? 'đồng thời trên cả 8 cổng COM' : 'trên cổng ' + shortPortLabel(port)}...</td></tr>`;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port, baud, parity, stopbits,
        scan_all_ports: isScanAll,
        auto_baud: autoBaud,
        auto_parity: autoParity,
        baud_list: autoBaud ? selectedBauds : undefined,
        start_id: fromId,
        end_id: toId,
        fn_code: fnCode,
        test_addr: testAddr,
        quantity: quantity,
        timeout_ms: timeoutMs
      })
    });
    const data = await res.json();
    if (data.success) {
      lastScanResults = (data.found || []).map(d => ({ ...d, port: d.port || port }));
      const okCount = lastScanResults.filter(d => d.status === 'ONLINE').length;
      const excCount = lastScanResults.filter(d => d.status === 'ONLINE_EXCEPTION').length;
      const portDesc = isScanAll ? `${(data.scanned_ports || []).length} cổng COM chạy song song` : shortPortLabel(port);

      document.getElementById('lblScanStatus').textContent =
        `Hoàn tất! Đã kiểm tra ${data.scanned_steps} lượt cấu hình trên ${portDesc}.`;
      document.getElementById('lblScanCount').textContent =
        `Tìm thấy: ${data.unique_slaves} thiết bị (${okCount} chuẩn OK, ${excCount} ngoại lệ)`;

      lastScanResults.forEach(dev => {
        const el = document.getElementById(`slave-tile-${dev.id}`);
        if (el) {
          const isException = dev.status === 'ONLINE_EXCEPTION';
          const pLbl = dev.port_label || shortPortLabel(dev.port);
          el.className = isException ? 'slave-tile exception' : 'slave-tile online';
          el.innerHTML = `ID ${dev.id}<br><span style="font-size: 9px;">${pLbl} • ${dev.baud}</span>`;
          el.title = `${dev.detail} (${dev.latency}ms)`;
          el.onclick = () => applyDiscoveredDevice(dev);
        }
      });

      if (lastScanResults.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 14px;">Không tìm thấy thiết bị nào phản hồi trong dải cấu hình đã chọn.</td></tr>`;
      } else {
        tbody.innerHTML = lastScanResults.map((dev, idx) => {
          const isExc = dev.status === 'ONLINE_EXCEPTION';
          const badgeClass = isExc ? 'badge-purple' : 'badge-emerald';
          const statusLabel = isExc ? 'ONLINE (Ngoại Lệ)' : 'ONLINE (Chuẩn)';
          const pLbl = dev.port_label || shortPortLabel(dev.port);
          return `
            <tr>
              <td><span class="badge badge-cyan">${pLbl}</span></td>
              <td style="font-weight: 800; font-size: 14px; color: ${isExc ? '#c084fc' : 'var(--emerald)'};">ID ${dev.id}</td>
              <td><span style="font-family: monospace; font-weight: 700; color: #fff;">${dev.framing}</span></td>
              <td><span class="badge badge-cyan">FC0${dev.fn_code}</span> Addr: <b style="color: #fff;">${dev.addr}</b></td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="badge ${badgeClass}">${statusLabel}</span>
                  <span style="font-size: 12px; color: var(--text);">${dev.value_display || ''}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${dev.detail}</div>
              </td>
              <td style="color: var(--cyan); font-family: monospace;">${dev.latency} ms</td>
              <td>
                <button class="btn btn-primary" style="padding: 4px 10px; font-size: 11px;" onclick="applyDiscoveredDeviceIndex(${idx})">
                  Áp Dụng Vào Tab
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } else {
      document.getElementById('lblScanStatus').textContent = "Lỗi khi quét: " + (data.error || "Thất bại");
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--rose); padding: 14px;">${data.error}</td></tr>`;
    }
  } catch (err) {
    document.getElementById('lblScanStatus').textContent = "Lỗi kết nối API: " + err;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btnOrigHtml;
    }
  }
}

async function startRegisterMapScan() {
  const port = document.getElementById('selMapPort').value || globalSerial.port;
  const baud = parseInt(document.getElementById('selMapBaud').value) || globalSerial.baud;
  const slaveId = parseInt(document.getElementById('inpMapSlaveId').value) || 1;
  const fnCode = parseInt(document.getElementById('selMapFn').value) || 3;
  const startAddr = parseInt(document.getElementById('inpMapStart').value) || 0;
  const endAddr = parseInt(document.getElementById('inpMapEnd').value) || 31;

  const btn = document.getElementById('btnStartRegMap');
  btn.disabled = true;
  btn.innerHTML = `<span class="pulse-dot"></span> Đang Khảo Sát...`;

  const statusEl = document.getElementById('lblRegMapStatus');
  const tbody = document.getElementById('tblRegMapResults');
  statusEl.textContent = `Đang khảo sát Slave ID ${slaveId} (${baud} bps, FC0${fnCode}, Địa chỉ ${startAddr} → ${endAddr})...`;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--cyan); padding: 14px;"><span class="pulse-dot"></span> Đang quét bản đồ thanh ghi...</td></tr>`;

  try {
    const res = await fetch('/api/scan/registers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port, baud,
        parity: globalSerial.parity,
        stopbits: globalSerial.stopbits,
        slave_id: slaveId,
        fn_code: fnCode,
        start_addr: startAddr,
        end_addr: endAddr,
        timeout_ms: 120
      })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = `Hoàn tất! Khảo sát ${data.probed_count} địa chỉ → Phát hiện ${data.valid_count} thanh ghi hợp lệ trên Slave ID ${slaveId}.`;
      const regs = data.registers || [];
      if (regs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 14px;">Không có thanh ghi hợp lệ trong dải ${startAddr}..${endAddr} (hoặc thiết bị không phản hồi).</td></tr>`;
      } else {
        tbody.innerHTML = regs.map(r => `
          <tr>
            <td style="color: var(--cyan); font-weight: 700;">${r.addr}</td>
            <td style="color: #94a3b8;">${r.hex_addr}</td>
            <td style="color: var(--emerald); font-weight: 700;">${r.uint16}</td>
            <td>${r.int16}</td>
            <td>${r.hex_val}</td>
            <td>${r.latency} ms</td>
            <td>
              <button class="btn btn-outline" style="padding: 2px 8px; font-size: 11px;"
                onclick="applyDiscoveredDevice({ port: '${port}', id: ${slaveId}, baud: ${baud}, parity: '${globalSerial.parity}', stopbits: ${globalSerial.stopbits}, fn_code: ${fnCode}, addr: ${r.addr} })">
                Mở Tab Tại Đây
              </button>
            </td>
          </tr>
        `).join('');
      }
    } else {
      statusEl.textContent = "Lỗi: " + (data.error || "Không thể khảo sát");
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--rose); padding: 14px;">${data.error}</td></tr>`;
    }
  } catch (err) {
    statusEl.textContent = "Lỗi mạng: " + err;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🗺️ Quét Tìm Thanh Ghi Khả Dụng';
  }
}

function applyDiscoveredDeviceIndex(idx) {
  if (lastScanResults && lastScanResults[idx]) {
    applyDiscoveredDevice(lastScanResults[idx]);
  }
}

async function applyDiscoveredDevice(dev) {
  const p = dev.port || globalSerial.port;
  const b = dev.baud || globalSerial.baud;
  const par = dev.parity || 'N';
  const sb = dev.stopbits || 1;

  await pushSerialConfigToBackend(p, b, par, sb);

  addNewSessionTab();
  const newTab = sessionTabs[sessionTabs.length - 1];
  newTab.name = `${shortPortLabel(p)} • ID ${dev.id}`;
  newTab.port = p;
  newTab.baud = b;
  newTab.parity = par;
  newTab.stopbits = sb;
  newTab.slave_id = dev.id;
  newTab.fn_code = dev.fn_code || 3;
  newTab.start_addr = (dev.status === 'ONLINE_EXCEPTION') ? 0 : (dev.addr || 0);

  showView('poll');
  renderTabs();
}

// ==================== REALTIME TREND CHART ====================
function pushTrendRecord(vals) {
  if (!vals || vals.length === 0) return;
  trendHistory.push({
    time: new Date().toLocaleTimeString(),
    vals: vals.slice(0, 3)
  });
  if (trendHistory.length > 50) trendHistory.shift();
  if (currentView === 'trend') drawTrendCanvas();
}

function initTrendCanvas() {
  drawTrendCanvas();
}

function drawTrendCanvas() {
  const cvs = document.getElementById('trendCanvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const w = cvs.clientWidth;
  const h = cvs.clientHeight;
  cvs.width = w;
  cvs.height = h;

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let y = 30; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (trendHistory.length < 2) return;

  const colors = ['#06b6d4', '#10b981', '#f59e0b'];
  const chks = [
    document.getElementById('chkCh0')?.checked,
    document.getElementById('chkCh1')?.checked,
    document.getElementById('chkCh2')?.checked
  ];

  for (let ch = 0; ch < 3; ch++) {
    if (!chks[ch]) continue;
    ctx.strokeStyle = colors[ch];
    ctx.lineWidth = 2;
    ctx.beginPath();

    trendHistory.forEach((pt, i) => {
      const x = (i / (trendHistory.length - 1)) * (w - 40) + 20;
      const val = pt.vals[ch] || 0;
      const y = h - 30 - ((val % 500) / 500) * (h - 60);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

// ==================== MULTI-COM GATEWAY MATRIX, SMART ROUTER & COM2COM ====================
function initMultiGatewayMatrix() {
  const tbody = document.getElementById('tblMultiGatewayMatrix');
  if (!tbody) return;
  const baudOptsHtml = (selBaud) => STANDARD_BAUDS.map(b =>
    `<option value="${b}" ${b === selBaud ? 'selected' : ''}>${b} bps</option>`
  ).join('');

  tbody.innerHTML = multiGwConfigs.map((cfg, idx) => {
    const al = portAliasesCache[cfg.port] ? ` • <span style="color: var(--cyan);">${portAliasesCache[cfg.port]}</span>` : '';
    return `
    <tr>
      <td>
        <div style="font-weight: 800; color: #fff; font-size: 13px;">${cfg.com_label}${al}</div>
        <div style="font-size: 10px; color: var(--text-muted); font-family: monospace;">${cfg.port}</div>
      </td>
      <td>
        <input type="number" id="gwRowTcp_${idx}" value="${cfg.tcp_port}" min="1024" max="65535" style="width: 82px; font-family: monospace; font-weight: 700; color: var(--cyan);"
          onchange="multiGwConfigs[${idx}].tcp_port = parseInt(this.value) || ${5001 + idx}">
      </td>
      <td>
        <select id="gwRowBaud_${idx}" style="width: 125px;" onchange="multiGwConfigs[${idx}].baud = parseInt(this.value) || 9600">
          ${baudOptsHtml(cfg.baud)}
        </select>
      </td>
      <td>
        <select id="gwRowFrm_${idx}" style="width: 95px;" onchange="multiGwConfigs[${idx}].framing = this.value">
          <option value="N-1" selected>8N1</option>
          <option value="E-1">8E1</option>
          <option value="O-1">8O1</option>
          <option value="N-2">8N2</option>
        </select>
      </td>
      <td id="gwRowStatus_${idx}"><span class="badge badge-slate">ĐANG TẮT</span></td>
      <td id="gwRowClients_${idx}" style="font-family: monospace; color: var(--text-muted);">0</td>
      <td id="gwRowPkts_${idx}" style="font-family: monospace; color: var(--text-muted);">0</td>
      <td id="gwRowLat_${idx}" style="font-family: monospace; color: var(--text-muted);">--</td>
      <td>
        <button id="gwRowBtn_${idx}" class="btn btn-emerald" style="padding: 4px 12px; font-size: 11px;" onclick="toggleSingleRowGateway(${idx})">
          ▶ Bật
        </button>
      </td>
    </tr>
  `}).join('');
}

async function toggleGatewayAutoBoot(enabled) {
  try {
    await fetch('/api/gateway/autostart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: Boolean(enabled) })
    });
    showToast(enabled ? "Đã bật Tự động khôi phục Cầu nối Gateway khi bật nguồn Router!" : "Đã tắt tự động khôi phục Gateway khi khởi động.");
  } catch (e) {}
}

async function toggleSmartRouter() {
  const isOn = Boolean(smartRouterCache && smartRouterCache.running);
  if (isOn) {
    const res = await fetch('/api/gateway/smart_router/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json();
    if (d.success) {
      smartRouterCache = d.smart_router;
      syncSmartRouterUI(smartRouterCache);
      showToast("Đã dừng Smart Hub (:5000)");
    }
    return;
  }
  const tcpPort = parseInt(document.getElementById('inpSmartTcpPort').value) || 5000;
  const baseUid = parseInt(document.getElementById('inpSmartBaseUid').value) || 1;
  const realSid = parseInt(document.getElementById('inpSmartRealSid').value) || 1;
  const portConfigs = multiGwConfigs.map(cfg => {
    const fp = (cfg.framing || 'N-1').split('-');
    return { port: cfg.port, baud: cfg.baud, parity: fp[0] || 'N', stopbits: parseInt(fp[1]) || 1 };
  });
  const res = await fetch('/api/gateway/smart_router/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcp_port: tcpPort, mode: 'virtual_id', base_unit_id: baseUid, real_slave_id: realSid, port_configs: portConfigs })
  });
  const data = await res.json();
  if (data.success) {
    smartRouterCache = data.smart_router;
    syncSmartRouterUI(smartRouterCache);
    if (data.interfaces) renderNetworkInterfaces(data.interfaces);
    showToast(`Đã bật Smart Hub (:${tcpPort}): Unit ID ${baseUid}..${baseUid + 7} → COM 1..8 (Slave ${realSid})!`);
  } else {
    alert("Lỗi Smart Hub: " + (data.error || "Thất bại"));
  }
}

function syncSmartRouterUI(sr) {
  smartRouterCache = sr || { running: false };
  const b = document.getElementById('badgeSmartRouterState');
  const btn = document.getElementById('btnToggleSmartRouter');
  if (!b || !btn) return;
  if (smartRouterCache.running) {
    const st = smartRouterCache.stats || {};
    b.className = 'badge badge-emerald';
    b.innerHTML = `<span class="pulse-dot"></span>ĐANG CHẠY :${smartRouterCache.tcp_port} (${st.packets_routed || 0} gói)`;
    btn.className = 'btn btn-rose';
    btn.textContent = '⏹ Tắt Smart Hub';
  } else {
    b.className = 'badge badge-slate';
    b.textContent = 'ĐANG TẮT';
    btn.className = 'btn btn-emerald';
    btn.textContent = '⚡ Bật Smart Hub (:5000)';
  }
}

async function startComToComBridge() {
  const mPort = document.getElementById('selC2CMasterPort').value;
  const mBaud = parseInt(document.getElementById('selC2CMasterBaud').value) || 9600;
  const mFp = (document.getElementById('selC2CMasterFrm').value || 'N-1').split('-');
  const sPort = document.getElementById('selC2CSlavePort').value;
  const sBaud = parseInt(document.getElementById('selC2CSlaveBaud').value) || 115200;
  const sFp = (document.getElementById('selC2CSlaveFrm').value || 'N-1').split('-');
  if (mPort === sPort) {
    alert("Cổng Master Nguồn và Cổng Slave Đích phải là 2 cổng COM khác nhau!");
    return;
  }
  try {
    const res = await fetch('/api/bridge/com2com/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        master_port: mPort, master_baud: mBaud, master_parity: mFp[0], master_stopbits: parseInt(mFp[1]) || 1,
        slave_port: sPort, slave_baud: sBaud, slave_parity: sFp[0], slave_stopbits: parseInt(sFp[1]) || 1
      })
    });
    const data = await res.json();
    if (data.success) {
      renderComBridgesList(data.com_bridges || []);
      showToast(`Đã nối chuyển đổi tốc độ ${shortPortLabel(mPort)} (${mBaud}) ⇄ ${shortPortLabel(sPort)} (${sBaud})!`);
    } else {
      alert("Lỗi cầu nối COM↔COM: " + data.error);
    }
  } catch (e) {
    alert("Lỗi kết nối: " + e);
  }
}

async function stopComToComBridge(brId) {
  const res = await fetch('/api/bridge/com2com/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: brId })
  });
  const data = await res.json();
  if (data.success) {
    renderComBridgesList(data.com_bridges || []);
    showToast("Đã dừng cầu nối COM↔COM.");
  }
}

function renderComBridgesList(list) {
  comBridgesCache = list || [];
  const el = document.getElementById('listActiveComBridges');
  if (!el) return;
  if (comBridgesCache.length === 0) {
    el.innerHTML = 'Chưa có cầu nối chuyển đổi tốc độ COM↔COM nào đang chạy.';
    return;
  }
  el.innerHTML = comBridgesCache.map(b => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.35); border-radius: 6px; margin-bottom: 6px;">
      <div>
        <span class="badge badge-emerald"><span class="pulse-dot"></span>ACTIVE</span>
        <b style="color: #fff; margin-left: 6px;">${b.master_label} (${b.master_framing}) ⇄ ${b.slave_label} (${b.slave_framing})</b>
        <span style="color: var(--cyan); margin-left: 10px; font-family: monospace;">Đã chuyển: ${b.stats.frames_converted} khung (${b.stats.last_latency_ms}ms)</span>
      </div>
      <button class="btn btn-rose" style="padding: 3px 10px; font-size: 11px;" onclick="stopComToComBridge('${b.id}')">⏹ Ngắt Cầu Nối</button>
    </div>
  `).join('');
}

function applyBatch8Config() {
  const b = parseInt(document.getElementById('selBatch8Baud').value) || 9600;
  const f = document.getElementById('selBatch8Framing').value || 'N-1';
  multiGwConfigs.forEach((cfg, idx) => {
    cfg.baud = b;
    cfg.framing = f;
    const bEl = document.getElementById(`gwRowBaud_${idx}`);
    const fEl = document.getElementById(`gwRowFrm_${idx}`);
    if (bEl) bEl.value = String(b);
    if (fEl) fEl.value = f;
  });
}

function syncMultiGatewayMatrixState(gatewaysList) {
  activeGatewaysCache = gatewaysList || [];
  const mapByPort = {};
  activeGatewaysCache.forEach(g => { mapByPort[g.serial_port] = g; });

  let running8Count = 0;
  multiGwConfigs.forEach((cfg, idx) => {
    const g = mapByPort[cfg.port];
    const stEl = document.getElementById(`gwRowStatus_${idx}`);
    const clEl = document.getElementById(`gwRowClients_${idx}`);
    const pkEl = document.getElementById(`gwRowPkts_${idx}`);
    const ltEl = document.getElementById(`gwRowLat_${idx}`);
    const btEl = document.getElementById(`gwRowBtn_${idx}`);
    if (!stEl || !btEl) return;

    if (g && g.running) {
      running8Count++;
      stEl.innerHTML = `<span class="badge badge-emerald"><span class="pulse-dot"></span>:${g.tcp_port}</span>`;
      clEl.textContent = g.stats.active_clients;
      clEl.style.color = g.stats.active_clients > 0 ? 'var(--emerald)' : '#fff';
      pkEl.textContent = g.stats.packets_bridged;
      pkEl.style.color = 'var(--cyan)';
      ltEl.textContent = g.stats.last_latency_ms ? `${g.stats.last_latency_ms} ms` : '--';
      btEl.className = "btn btn-rose";
      btEl.textContent = "⏹ Tắt";
    } else {
      stEl.innerHTML = `<span class="badge badge-slate">ĐANG TẮT</span>`;
      clEl.textContent = "0";
      clEl.style.color = 'var(--text-muted)';
      pkEl.textContent = "0";
      pkEl.style.color = 'var(--text-muted)';
      ltEl.textContent = "--";
      btEl.className = "btn btn-emerald";
      btEl.textContent = "▶ Bật";
    }
  });

  const sumEl = document.getElementById('lblMultiGwSummary');
  if (sumEl) {
    sumEl.className = running8Count > 0 ? 'badge badge-emerald' : 'badge badge-slate';
    sumEl.textContent = `Đang chạy: ${running8Count} / 8 cổng`;
  }
}

async function toggleSingleRowGateway(idx) {
  const cfg = multiGwConfigs[idx];
  if (!cfg) return;
  const isRowActive = activeGatewaysCache.some(g => g.serial_port === cfg.port && g.running);
  const fp = (cfg.framing || 'N-1').split('-');
  const parity = fp[0] || 'N';
  const stopbits = parseInt(fp[1]) || 1;
  const endpoint = isRowActive ? '/api/gateway/stop' : '/api/gateway/start';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: cfg.port,
        tcp_port: cfg.tcp_port,
        baud: cfg.baud,
        parity,
        stopbits
      })
    });
    const data = await res.json();
    if (data.success) {
      syncMultiGatewayMatrixState(data.gateways || []);
      isGatewayRunning = (data.gateways || []).length > 0;
      updateGatewayUI(data.gateway_port, data.gateways || []);
      if (data.interfaces) renderNetworkInterfaces(data.interfaces);
    } else {
      alert("Lỗi Gateway: " + (data.error || "Thất bại"));
    }
  } catch (err) {
    alert("Lỗi kết nối Gateway: " + err);
  }
}

async function startAll8Gateways() {
  const configs = multiGwConfigs.map(cfg => {
    const fp = (cfg.framing || 'N-1').split('-');
    return {
      port: cfg.port,
      tcp_port: cfg.tcp_port,
      baud: cfg.baud,
      parity: fp[0] || 'N',
      stopbits: parseInt(fp[1]) || 1
    };
  });
  try {
    const res = await fetch('/api/gateway/start_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs })
    });
    const data = await res.json();
    if (data.success) {
      syncMultiGatewayMatrixState(data.gateways || []);
      isGatewayRunning = (data.gateways || []).length > 0;
      updateGatewayUI(5001, data.gateways || []);
      if (data.interfaces) renderNetworkInterfaces(data.interfaces);
    } else {
      alert("Lỗi bật đồng loạt 8 cổng: " + (data.error || "Thất bại"));
    }
  } catch (err) {
    alert("Lỗi kết nối API: " + err);
  }
}

async function stopAllGateways() {
  try {
    const res = await fetch('/api/gateway/stop_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
    const data = await res.json();
    if (data.success) {
      syncMultiGatewayMatrixState([]);
      isGatewayRunning = false;
      updateGatewayUI(5000, []);
      if (data.interfaces) renderNetworkInterfaces(data.interfaces);
    }
  } catch (err) {
    alert("Lỗi dừng Gateway: " + err);
  }
}

async function toggleGateway() {
  const port = document.getElementById('selGwPort').value || globalSerial.port;
  const baud = parseInt(document.getElementById('selGwBaud').value) || globalSerial.baud;
  const fp = (document.getElementById('selGwFraming').value || 'N-1').split('-');
  const parity = fp[0] || 'N';
  const stopbits = parseInt(fp[1]) || 1;
  const tcpPort = parseInt(document.getElementById('inpGwTcpPort').value) || 5000;
  const isPortRunning = activeGatewaysCache.some(g => g.serial_port === port && g.running);
  const endpoint = isPortRunning ? '/api/gateway/stop' : '/api/gateway/start';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baud, parity, stopbits, tcp_port: tcpPort })
    });
    const data = await res.json();
    if (data.success) {
      const gws = data.gateways || [];
      syncMultiGatewayMatrixState(gws);
      isGatewayRunning = gws.length > 0;
      updateGatewayUI(tcpPort, gws);
      if (data.interfaces) renderNetworkInterfaces(data.interfaces);
    } else {
      alert("Lỗi Gateway: " + data.error);
    }
  } catch (err) {
    alert("Lỗi kết nối Gateway: " + err);
  }
}

function updateGatewayUI(tcpPort, gatewaysList) {
  const badge = document.getElementById('badgeGateway');
  const btn = document.getElementById('btnGwToggleView');
  const gws = gatewaysList || activeGatewaysCache || [];
  const count = gws.length;
  const srOn = Boolean(smartRouterCache && smartRouterCache.running);
  if ((isGatewayRunning && count > 0) || srOn) {
    if (badge) {
      badge.className = "badge badge-emerald";
      if (srOn) {
        badge.innerHTML = `<span class="pulse-dot"></span>Smart Hub (:${smartRouterCache.tcp_port})`;
      } else if (count > 1) {
        const portsSorted = gws.map(g => g.tcp_port).sort((a, b) => a - b);
        badge.innerHTML = `<span class="pulse-dot"></span>Gateway: ${count} CỔNG (:${portsSorted[0]}..${portsSorted[portsSorted.length - 1]})`;
      } else {
        const p = gws[0].tcp_port || tcpPort || 5000;
        badge.innerHTML = `<span class="pulse-dot"></span>Gateway: CHẠY (:${p})`;
      }
    }
    if (btn) {
      const selP = document.getElementById('selGwPort') ? document.getElementById('selGwPort').value : '';
      const selActive = gws.some(g => g.serial_port === selP && g.running);
      btn.className = selActive ? "btn btn-rose" : "btn btn-emerald";
      btn.textContent = selActive ? "Tắt Cầu Nối Cổng Này" : "Kích Hoạt Cầu Nối Đơn";
    }
  } else {
    if (badge) {
      badge.className = "badge badge-amber";
      badge.textContent = "Gateway: TẮT";
    }
    if (btn) {
      btn.className = "btn btn-emerald";
      btn.textContent = "Kích Hoạt Cầu Nối Đơn";
    }
  }
}

// ==================== MULTI-PORT CONCURRENT DATALOGGER ====================
function addDatalogChannelRow() {
  const t = getActiveTab();
  const port = document.getElementById('selLogPort').value || globalSerial.port;
  const baud = parseInt(document.getElementById('selLogBaud').value) || globalSerial.baud;
  const slave = parseInt(document.getElementById('inpLogSlave').value) || 1;
  const startAddrEl = document.getElementById('inpLogStartAddr');
  const startAddr = startAddrEl ? (parseInt(startAddrEl.value) || 0) : 0;
  const count = parseInt(document.getElementById('inpLogCount').value) || 8;
  datalogChannelsList.push({
    label: portAliasesCache[port] || shortPortLabel(port).replace(" ", ""),
    port, baud, parity: globalSerial.parity || 'N', stopbits: globalSerial.stopbits || 1,
    slave_id: slave, fn_code: t ? t.fn_code : 3, start_addr: startAddr, count: count,
    tags: {}, scales: {}, units: {}
  });
  renderDatalogChannelsTable();
}

function importPollingTabsToDatalogger() {
  datalogChannelsList = sessionTabs.map(t => ({
    label: (t.name || shortPortLabel(t.port)).replace(/\s+/g, "_"),
    port: t.port,
    baud: t.baud,
    parity: t.parity || "N",
    stopbits: t.stopbits || 1,
    slave_id: t.slave_id,
    fn_code: t.fn_code,
    start_addr: t.start_addr,
    count: t.count,
    disabled_addrs: Array.from(parseAddrRangeSet(t.disabled_addrs)).sort((a, b) => a - b),
    only_tagged: Boolean(t.only_tagged),
    tags: { ...(t.tags || {}) },
    scales: { ...(t.scales || {}) },
    units: { ...(t.units || {}) }
  }));
  renderDatalogChannelsTable();
  showToast(`Đã nạp ${datalogChannelsList.length} Tab Polling (kèm cấu hình né thanh ghi cấm đọc) vào Datalogger!`);
}

function removeDatalogChannel(idx) {
  datalogChannelsList.splice(idx, 1);
  renderDatalogChannelsTable();
}

function renderDatalogChannelsTable() {
  const box = document.getElementById('boxDatalogChannelsList');
  if (!box) return;
  if (datalogChannelsList.length === 0) {
    box.innerHTML = 'Chưa thêm kênh đa cổng (mặc định ghi đơn kênh từ bộ chọn phía trên). Nhấn <b>➕ Thêm Kênh Đa Cổng</b> hoặc <b>⚡ Nạp Từ Các Tab Polling</b> để ghi 2–8 cổng COM cùng lúc!';
    return;
  }
  box.innerHTML = datalogChannelsList.map((ch, idx) => {
    const disCnt = parseAddrRangeSet(ch.disabled_addrs).size;
    const skipTxt = disCnt > 0 ? ` • <span style="color: var(--amber);">Né ${disCnt} ô cấm</span>` : '';
    return `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.25); border-radius: 6px; margin-bottom: 4px;">
      <div>
        <span class="badge badge-cyan">#${idx + 1} ${shortPortLabel(ch.port)}</span>
        <b style="color: #fff; margin-left: 6px;">${ch.label}</b>
        <span style="color: var(--text-muted); margin-left: 8px; font-family: monospace;">${ch.baud} 8${ch.parity}${ch.stopbits} • Slave ${ch.slave_id} • FC0${ch.fn_code} • Addr ${ch.start_addr} (${ch.count} kênh)${skipTxt}</span>
      </div>
      <button class="btn btn-outline" style="padding: 2px 8px; font-size: 10px; color: var(--rose);" onclick="removeDatalogChannel(${idx})">✕ Xóa</button>
    </div>
  `}).join('');
}

async function toggleLogger() {
  const t = getActiveTab();
  const endpoint = isLoggerRunning ? '/api/datalog/stop' : '/api/datalog/start';
  const name = document.getElementById('inpLogName').value;
  const port = document.getElementById('selLogPort').value || globalSerial.port;
  const baud = parseInt(document.getElementById('selLogBaud').value) || globalSerial.baud;
  const interval = parseInt(document.getElementById('selLogInterval').value);
  const slave = parseInt(document.getElementById('inpLogSlave').value);
  const startAddrEl = document.getElementById('inpLogStartAddr');
  const startAddr = startAddrEl ? (parseInt(startAddrEl.value) || 0) : 0;
  const count = parseInt(document.getElementById('inpLogCount').value);
  const batch = parseInt(document.getElementById('selLogBatch').value) || 30;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        port: port,
        baud: baud,
        parity: globalSerial.parity || 'N',
        stopbits: globalSerial.stopbits || 1,
        interval_sec: interval,
        slave_id: slave,
        start_addr: startAddr,
        count: count,
        fn_code: t.fn_code,
        batch_size: batch,
        channels: datalogChannelsList.length > 0 ? datalogChannelsList : undefined
      })
    });
    const data = await res.json();
    if (data.success) {
      isLoggerRunning = !isLoggerRunning;
      updateLoggerUI();
      loadSessions();
    } else {
      alert("Lỗi Datalogger: " + (data.error || "Thất bại"));
    }
  } catch (err) {
    alert("Lỗi Datalogger: " + err);
  }
}

function updateLoggerUI() {
  const btn = document.getElementById('btnLogToggleView');
  if (!btn) return;
  if (isLoggerRunning) {
    btn.className = "btn btn-rose";
    btn.textContent = "Dừng Ghi Thẻ Nhớ";
  } else {
    btn.className = "btn btn-emerald";
    btn.textContent = "Bắt Đầu Ghi Thẻ Nhớ";
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/datalog/sessions');
    const list = await res.json();
    const tbody = document.getElementById('tblSessions');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">Chưa có phiên ghi nào trên thẻ nhớ.</td></tr>`;
      return;
    }
    list.forEach(s => {
      const csvSizeKb = (s.csv_size / 1024).toFixed(1);
      const jsonlSizeKb = (s.jsonl_size / 1024).toFixed(1);
      const tr = document.createElement('tr');

      let statusBadge = s.is_active
        ? `<span class="badge badge-emerald" style="padding: 1px 6px; font-size: 10px;"><span class="pulse-dot"></span> ĐANG GHI</span>`
        : `<span class="badge badge-slate" style="padding: 1px 6px; font-size: 10px;">ĐÃ XONG</span>`;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
            ${s.name} ${statusBadge}
          </div>
          <div style="font-size: 11px; font-family: monospace; color: var(--text-muted); margin-top: 2px;">
            ID: ${s.id}
          </div>
        </td>
        <td style="color: var(--cyan); font-family: monospace; font-size: 12px;">${s.started_at}</td>
        <td><span class="badge badge-cyan">${s.interval_sec}s</span></td>
        <td style="color: var(--emerald); font-weight: 700; font-family: monospace;">${s.sample_count} mẫu</td>
        <td style="font-size: 11px; line-height: 1.5;">
          <div>CSV: <b style="color: var(--cyan);">${csvSizeKb} KB</b></div>
          ${s.jsonl_exists ? `<div>JSONL: <b style="color: #c084fc;">${jsonlSizeKb} KB</b></div>` : ''}
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${s.csv_name ? `<a href="/api/datalog/download?file=${s.csv_name}" class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; text-decoration: none;" title="Tải bảng dữ liệu CSV">📊 Tải CSV</a>` : ''}
            ${s.jsonl_exists ? `<a href="/api/datalog/download?file=${s.jsonl_name}" class="btn btn-primary" style="padding: 3px 8px; font-size: 11px; text-decoration: none;" title="Tải luồng dữ liệu AI Telemetry JSONL">🤖 AI JSONL</a>` : ''}
            ${s.manifest_exists ? `<a href="/api/datalog/download?file=${s.manifest_name}" class="btn btn-outline" style="padding: 3px 6px; font-size: 11px; text-decoration: none;" title="Tải Manifest tóm tắt cấu trúc">📋 Manifest</a>` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {}
}

// ==================== 8-PORT LIVE LED STRIP ====================
function renderHeaderComStrip(ch348Data, gws, bridges) {
  const strip = document.getElementById('headerComStrip');
  if (!strip) return;
  if (!ch348Data || !ch348Data.online || !Array.isArray(ch348Data.ports)) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'inline-flex';
  const gwSet = new Set((gws || []).filter(g => g.running).map(g => g.serial_port));
  (bridges || []).forEach(b => { if (b.running) { gwSet.add(b.master_port); gwSet.add(b.slave_port); } });

  strip.innerHTML = ch348Data.ports.map(p => {
    const isGw = gwSet.has(p.device);
    const isTxRx = Boolean(p.active_tx || p.active_rx);
    const cls = isGw ? 'led-gw' : (isTxRx ? 'led-txrx' : '');
    const al = portAliasesCache[p.device] ? ` [${portAliasesCache[p.device]}]` : '';
    const tip = `${p.com_label}${al} (${p.device})\nKhung: ${p.framing}\nTX: ${p.tx_bytes}B | RX: ${p.rx_bytes}B${isGw ? '\nĐang chạy Gateway/Bridge' : ''}`;
    return `<span class="com-led-pill ${cls}" title="${tip}" onclick="openSerialConfigModal('${p.device}')">●${p.index + 1}</span>`;
  }).join('');
}

// ==================== DYNAMIC NETWORK INTERFACES ====================
function renderNetworkInterfaces(ifaces) {
  const container = document.getElementById('gridNetworkInterfaces');
  if (!container || !ifaces) return;
  const countEl = document.getElementById('badgeIfaceCount');
  if (countEl) countEl.textContent = `${ifaces.length} Cổng Khả Dụng`;

  container.innerHTML = ifaces.map(iface => `
    <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-weight: 700; color: #fff; font-size: 13px;">${iface.label}</span>
          <span class="badge badge-${iface.badge_color || 'cyan'}">${iface.status}</span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4; min-height: 32px;">
          ${iface.description}
        </div>
      </div>

      <div style="background: rgba(0,0,0,0.4); border-radius: 6px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: var(--text-muted);">Modbus TCP Gateway:</span>
          <button class="btn btn-outline" style="padding: 2px 8px; font-size: 10px; cursor: pointer;" onclick="copyEndpoint('${iface.gw_endpoint}')">Sao Chép</button>
        </div>
        <div style="font-family: monospace; font-size: 14px; font-weight: 700; color: var(--cyan); margin-top: 2px;">
          ${iface.gw_endpoint}
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.08);">
        <span style="color: var(--text-muted);">Web Studio:</span>
        <a href="${iface.web_endpoint}" target="_blank" style="color: var(--emerald); text-decoration: none; font-weight: 600;">${iface.web_endpoint} ↗</a>
      </div>
    </div>
  `).join('');
}

function copyEndpoint(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Đã sao chép điểm cuối: " + text);
    }).catch(() => {
      prompt("Sao chép điểm cuối kết nối:", text);
    });
  } else {
    prompt("Sao chép điểm cuối kết nối:", text);
  }
}

// ==================== SYSTEM STATUS & HARDWARE TELEMETRY ====================
async function updateSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status === 'online') {
      if (data.active_profile_name) {
        currentProfileName = data.active_profile_name;
      }
      const profs = data.saved_profiles || data.sd_profiles || data.profiles;
      if (Array.isArray(profs) && typeof syncSdProfilesDropdown === 'function') {
        syncSdProfilesDropdown(profs);
      }
      if (data.port_aliases) {
        const changed = JSON.stringify(portAliasesCache) !== JSON.stringify(data.port_aliases);
        portAliasesCache = data.port_aliases;
        if (changed) initMultiGatewayMatrix();
      }

      if (!savedTabsHydrated) {
        savedTabsHydrated = true;
        if (Array.isArray(data.saved_polling_tabs) && data.saved_polling_tabs.length > 0 && sessionTabs.length === 1 && sessionTabs[0].values.length === 0) {
          if (typeof hydrateTabsFromProfileArray === 'function') {
            hydrateTabsFromProfileArray(data.saved_polling_tabs);
          }
        }
      }

      // 1. Sync CH348 8-Port Hub & Serial Ports
      if (data.ch348) {
        const chBadge = document.getElementById('badgeCh348');
        const sysCh = document.getElementById('lblSysCh348');
        if (data.ch348.online) {
          if (chBadge) {
            chBadge.style.display = 'inline-flex';
            chBadge.textContent = `🐙 ${data.ch348.chip_type || 'CH348L'}: ${data.ch348.port_count || 8} COM`;
          }
          if (sysCh) {
            sysCh.style.color = 'var(--emerald)';
            sysCh.textContent = `${data.ch348.chip_type} (Ver ${data.ch348.chip_ver}) • 8 UART Độc Lập (/dev/ttyCH0..7)`;
          }
        } else {
          if (chBadge) chBadge.style.display = 'none';
          if (sysCh) {
            sysCh.style.color = 'var(--text-muted)';
            sysCh.textContent = 'Không cắm bộ mở rộng đa cổng USB';
          }
        }
        renderHeaderComStrip(data.ch348, data.gateways, data.com_bridges);
      }

      if (data.available_ports && data.available_ports.length > 0) {
        availablePortsCache = data.available_ports;
        refreshPortDropdowns();
      }

      if (data.serial_port && data.baudrate) {
        globalSerial = {
          port: data.serial_port,
          baud: data.baudrate,
          parity: data.parity || 'N',
          stopbits: data.stopbits || 1
        };
        if (!firstPortSyncDone) {
          firstPortSyncDone = true;
          const validIds = new Set(availablePortsCache.map(p => p.id));
          if (!validIds.has(sessionTabs[0].port)) {
            sessionTabs[0].port = data.serial_port;
            sessionTabs[0].baud = data.baudrate;
            sessionTabs[0].parity = data.parity || 'N';
            sessionTabs[0].stopbits = data.stopbits || 1;
            syncToolbarWithActiveTab();
          }
          const c2cS = document.getElementById('selC2CSlavePort');
          if (c2cS && validIds.has('/dev/ttyCH1')) c2cS.value = '/dev/ttyCH1';
          const c2cSB = document.getElementById('selC2CSlaveBaud');
          if (c2cSB) c2cSB.value = '115200';
        }
        const actTab = getActiveTab();
        if (currentView === 'poll' && actTab) {
          updateHeaderSerialBadge(actTab.port, actTab.baud, actTab.parity || 'N', actTab.stopbits || 1);
        } else {
          updateHeaderSerialBadge(globalSerial.port, globalSerial.baud, globalSerial.parity, globalSerial.stopbits);
        }
      }

      // 2. Dynamic Network Interfaces
      if (data.network_interfaces) {
        renderNetworkInterfaces(data.network_interfaces);
      }

      // 3. Battery Telemetry
      if (data.battery && data.battery.percent !== null && data.battery.percent !== undefined) {
        const pct = data.battery.percent;
        const chg = data.battery.charging;
        const battEl = document.getElementById('badgeBatt');
        if (battEl) {
          battEl.className = pct > 20 ? 'badge badge-emerald' : 'badge badge-rose';
          battEl.textContent = `🔋 Pin: ${pct}% (${chg ? '⚡Sạc' : 'Pin'})`;
        }
        const sysPct = document.getElementById('lblSysBattPct');
        if (sysPct) sysPct.textContent = `${pct}%`;
        const stEl = document.getElementById('lblSysBattState');
        if (stEl) {
          stEl.className = chg ? 'badge badge-emerald' : 'badge badge-amber';
          stEl.textContent = chg ? '⚡ Đang sạc' : 'Dùng Pin';
        }
        const barBatt = document.getElementById('barSysBatt');
        if (barBatt) barBatt.style.width = `${Math.min(100, Math.max(0, pct))}%`;
        if (data.battery.cycles !== null && data.battery.cycles !== undefined) {
          const noteEl = document.getElementById('lblSysBattNote');
          if (noteEl) noteEl.textContent = `MCU Onboard • Chu kỳ/Mã: ${data.battery.cycles}`;
        }
      }

      // 4. Device Temperature
      const tempC = (data.temperature_c !== null && data.temperature_c !== undefined)
        ? data.temperature_c
        : (data.battery && data.battery.temperature !== null ? data.battery.temperature : null);
      if (tempC !== null && tempC !== undefined) {
        const tempEl = document.getElementById('badgeTemp');
        const isHot = tempC >= 60;
        const isWarm = tempC >= 48 && tempC < 60;
        if (tempEl) {
          tempEl.className = isHot ? 'badge badge-rose' : (isWarm ? 'badge badge-amber' : 'badge badge-cyan');
          tempEl.textContent = `🌡️ ${tempC}°C`;
        }
        const sysT = document.getElementById('lblSysTempVal');
        if (sysT) sysT.textContent = `${tempC}°C`;
        const tb = document.getElementById('lblSysTempBadge');
        if (tb) {
          tb.className = isHot ? 'badge badge-rose' : (isWarm ? 'badge badge-amber' : 'badge badge-emerald');
          tb.textContent = isHot ? 'Nhiệt cao' : (isWarm ? 'Ấm' : 'Mát / Ổn định');
        }
        const barT = document.getElementById('barSysTemp');
        if (barT) barT.style.width = `${Math.min(100, Math.max(5, (tempC / 80) * 100))}%`;
      }

      // 5. RAM Trống
      if (data.mem) {
        const freeMb = data.mem.free_mb;
        const totMb = data.mem.total_mb || 124;
        const freePct = Math.round((freeMb / totMb) * 100);
        const br = document.getElementById('badgeRam');
        if (br) br.textContent = `🧠 RAM trống: ${freeMb}/${totMb} MB`;
        const sr = document.getElementById('lblSysRam');
        if (sr) sr.textContent = `${freeMb} MB`;
        const srt = document.getElementById('lblSysRamTotal');
        if (srt) srt.textContent = `Tổng ${totMb} MB`;
        const srn = document.getElementById('lblSysRamNote');
        if (srn) srn.textContent = `Còn trống ${freePct}% bộ nhớ RAM`;
        const barR = document.getElementById('barSysRam');
        if (barR) barR.style.width = `${Math.min(100, freePct)}%`;
      }

      // 6. Flash Trống
      if (data.flash && data.flash.total_mb > 0) {
        const flFree = data.flash.free_mb;
        const flTot = data.flash.total_mb;
        const flPct = Math.round((flFree / flTot) * 100);
        const bf = document.getElementById('badgeFlash');
        if (bf) bf.textContent = `💾 Flash trống: ${flFree} MB`;
        const sf = document.getElementById('lblSysFlashFree');
        if (sf) sf.textContent = `${flFree} MB`;
        const sft = document.getElementById('lblSysFlashTotal');
        if (sft) sft.textContent = `Tổng ${flTot} MB`;
        const sfn = document.getElementById('lblSysFlashNote');
        if (sfn) sfn.textContent = `/overlay còn trống ${flPct}% (${flFree}/${flTot} MB)`;
        const barF = document.getElementById('barSysFlash');
        if (barF) barF.style.width = `${Math.min(100, flPct)}%`;
      }

      // 7. Thẻ nhớ SD Trống
      if (data.sd_card) {
        const sdFree = data.sd_card.free_gb;
        const sdTot = data.sd_card.total_gb || 32;
        const sdPct = sdTot > 0 ? Math.round((sdFree / sdTot) * 100) : 0;
        const bsd = document.getElementById('badgeSd');
        if (bsd) bsd.textContent = `💳 SD trống: ${sdFree} GB`;
        const sfg = document.getElementById('lblSysFreeGb');
        if (sfg) sfg.textContent = `${sdFree} GB`;
        const ssd = document.getElementById('lblSysSd');
        if (ssd) ssd.textContent = `${data.sd_card.path} (${sdTot} GB)`;
        const barSd = document.getElementById('barSysSd');
        if (barSd) barSd.style.width = `${Math.min(100, sdPct)}%`;
      }

      if (data.uptime) {
        const upEl = document.getElementById('lblSysUptime');
        if (upEl) upEl.textContent = data.uptime;
      }

      // 8. Multi-Port Gateway, Smart Router, COM-to-COM & Datalogger state sync
      const chkBoot = document.getElementById('chkGwAutoBoot');
      if (chkBoot && data.auto_start_gateways !== undefined) {
        chkBoot.checked = Boolean(data.auto_start_gateways);
      }
      if (data.smart_router) syncSmartRouterUI(data.smart_router);
      if (data.com_bridges) renderComBridgesList(data.com_bridges);

      const gws = data.gateways || [];
      syncMultiGatewayMatrixState(gws);
      isGatewayRunning = Boolean(data.gateway_running);
      updateGatewayUI(data.gateway_port, gws);

      if (data.gateway_stats) {
        const gc = document.getElementById('gwClientsVal');
        if (gc) gc.textContent = data.gateway_stats.active_clients;
        const gp = document.getElementById('gwPacketsVal');
        if (gp) gp.textContent = data.gateway_stats.packets_bridged;
        const gl = document.getElementById('gwLatencyVal');
        if (gl) gl.textContent = data.gateway_stats.last_latency_ms + " ms";
        const gb = document.getElementById('gwBytesVal');
        if (gb) gb.textContent = `${(data.gateway_stats.bytes_tx/1024).toFixed(1)}K / ${(data.gateway_stats.bytes_rx/1024).toFixed(1)}K`;
      }
      if (data.logger_running !== isLoggerRunning) {
        isLoggerRunning = data.logger_running;
        updateLoggerUI();
      }
      if (data.datalog_buffered !== undefined) {
        const cacheBadge = document.getElementById('badgeRamCache');
        if (cacheBadge) {
          if (data.logger_running) {
            cacheBadge.textContent = `RAM Cache: ${data.datalog_buffered}/${data.datalog_batch_size || 30} mẫu (Đang gom)`;
            cacheBadge.className = "badge badge-cyan";
          } else {
            cacheBadge.textContent = `RAM Cache: Sẵn sàng (${data.datalog_batch_size || 30} mẫu/lần)`;
            cacheBadge.className = "badge badge-slate";
          }
        }
      }
      const tm = document.getElementById('lblTime');
      if (tm) tm.textContent = data.timestamp;
    }
  } catch (err) {}
}

// ==================== INITIALIZATION & STATE RESTORATION ====================
window.addEventListener('DOMContentLoaded', () => {
  initStandardSelectors();
  initMultiGatewayMatrix();
  if (typeof renderAiTemplatePreview === 'function') renderAiTemplatePreview(0);

  // Restore saved UI state (currentView, sessionTabs, activeTabId, sdStudioSelectedFilename, disclosure states)
  if (typeof restoreUiStateFromStorage === 'function') {
    restoreUiStateFromStorage();
  }

  // Default Point Inspector collapsed on both Desktop & Mobile so main table/cards are never covered
  const insp = document.getElementById('pointInspector');
  if (insp) insp.classList.add('collapsed');

  if (window.innerWidth <= 820) {
    toggleMobileCardMode(true);
    toggleMobileConfigCollapse(isMobileConfigCollapsed);
  } else {
    toggleMobileCardMode(Boolean(isMobileCardView));
  }

  // Restore active sub-tabs
  if (activeSubTabs) {
    if (activeSubTabs.scanner) switchScannerTab(activeSubTabs.scanner);
    if (activeSubTabs.gateway) switchGatewayTab(activeSubTabs.gateway);
    if (activeSubTabs.datalog) switchDatalogTab(activeSubTabs.datalog);
    if (activeSubTabs.aidoc) switchAiDocTab(activeSubTabs.aidoc);
    if (activeSubTabs.sdInsp) switchSdInspectorTab(activeSubTabs.sdInsp);
  }

  renderTabs();
  showView(currentView || 'poll', true);
  updateSystemStatus();
  setInterval(updateSystemStatus, 4000);
});

window.addEventListener('hashchange', () => {
  const hashView = (window.location.hash || '').replace(/^#/, '').trim();
  const validViews = new Set(['poll', 'profiles', 'scanner', 'trend', 'gateway', 'datalog', 'aidoc', 'system']);
  if (validViews.has(hashView) && hashView !== currentView) {
    showView(hashView, true);
  }
});
