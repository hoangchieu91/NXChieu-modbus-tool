// ============================================================================
// NXChieu Modbus Studio Pro v3.3 — Scanner, Gateway, Datalogger & Hardware Status
// File: router_app/web/js/scanner_gateway_datalog.js
// ============================================================================

let lastScanResults = [];

function renderScannerGrid(customFrom, customTo) {
  const grid = document.getElementById('scannerGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const isTcpTab = (typeof activeSubTabs !== 'undefined' && activeSubTabs.scanner === 'tcp');
  const fromInputId = isTcpTab ? 'inpTcpScanFromId' : 'inpScanFrom';
  const toInputId = isTcpTab ? 'inpTcpScanToId' : 'inpScanTo';
  const fromId = (customFrom !== undefined && customFrom !== null) ? customFrom : (parseInt(document.getElementById(fromInputId)?.value) || 1);
  const toId = (customTo !== undefined && customTo !== null) ? customTo : (parseInt(document.getElementById(toInputId)?.value) || 16);
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

  if (typeof isTcpPortString === 'function' && !isTcpPortString(p)) {
    await pushSerialConfigToBackend(p, b, par, sb);
  }

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

  if (typeof refreshPortDropdowns === 'function') refreshPortDropdowns();
  showView('poll');
  renderTabs();
}

// ==================== MODBUS TCP & RTU-OVER-TCP SCANNER / TESTER ====================
let isTcpSweepDrawerOpen = false;

function setTcpScannerPreset(host, tcpPort, proto) {
  const hEl = document.getElementById('inpTcpScanHost');
  const pEl = document.getElementById('inpTcpScanPort');
  const prEl = document.getElementById('selTcpScanProto');
  if (hEl) hEl.value = host || '192.168.10.1';
  if (pEl) pEl.value = String(tcpPort || 502);
  if (prEl) prEl.value = proto || 'tcp';
  showToast(`Đã chọn đích ${proto === 'rtuovertcp' ? 'RTU-over-TCP' : 'Modbus TCP'}: ${host}:${tcpPort}`);
}

function toggleTcpSubnetSweepDrawer(forceState) {
  const drawer = document.getElementById('tcpSubnetSweepDrawer');
  const arr = document.getElementById('icoTcpSweepArrow');
  isTcpSweepDrawerOpen = (typeof forceState === 'boolean') ? forceState : !isTcpSweepDrawerOpen;
  if (drawer) drawer.classList.toggle('open', isTcpSweepDrawerOpen);
  if (arr) arr.textContent = isTcpSweepDrawerOpen ? '▴' : '▾';
}

function openTcpTargetInPollFromScanner() {
  let host = (document.getElementById('inpTcpScanHost')?.value || '192.168.10.1').trim();
  host = host.replace(/^(tcp|rtuovertcp|rtu_tcp):\/\//i, '');
  const tcpPort = parseInt(document.getElementById('inpTcpScanPort')?.value) || 502;
  const proto = (document.getElementById('selTcpScanProto')?.value || 'tcp').trim();
  const unitId = parseInt(document.getElementById('inpTcpScanFromId')?.value) || 1;
  const fnCode = parseInt(document.getElementById('selTcpScanFn')?.value) || 3;
  const addr = parseInt(document.getElementById('inpTcpScanAddr')?.value) || 0;
  const qty = Math.max(1, Math.min(250, parseInt(document.getElementById('inpTcpScanQty')?.value) || 10));
  const endpoint = `${proto}://${host}:${tcpPort}`;

  addNewSessionTab();
  const newTab = sessionTabs[sessionTabs.length - 1];
  newTab.name = `TCP ${host}:${tcpPort} • ID ${unitId}`;
  newTab.port = endpoint;
  newTab.slave_id = unitId;
  newTab.fn_code = fnCode;
  newTab.start_addr = addr;
  newTab.count = Math.max(qty, 10);

  if (typeof refreshPortDropdowns === 'function') refreshPortDropdowns();
  showView('poll');
  renderTabs();
  showToast(`Đã mở Tab Polling Modbus TCP kết nối tới ${endpoint} (Unit ID ${unitId})`);
}

async function runTcpQuickTest() {
  const host = (document.getElementById('inpTcpScanHost')?.value || '192.168.10.1').trim();
  const tcpPort = parseInt(document.getElementById('inpTcpScanPort')?.value) || 502;
  const protocol = (document.getElementById('selTcpScanProto')?.value || 'tcp').trim();
  const unitId = parseInt(document.getElementById('inpTcpScanFromId')?.value) || 1;
  const fnCode = parseInt(document.getElementById('selTcpScanFn')?.value) || 3;
  const testAddr = parseInt(document.getElementById('inpTcpScanAddr')?.value) || 0;
  const quantity = Math.max(1, Math.min(125, parseInt(document.getElementById('inpTcpScanQty')?.value) || 1));
  const timeoutMs = parseInt(document.getElementById('selTcpScanTimeout')?.value) || 400;

  const btn = document.getElementById('btnTcpQuickTest');
  const box = document.getElementById('tcpQuickTestResultBox');
  const origHtml = btn ? btn.innerHTML : '⚡ Ping TCP &amp; Đọc Thử Ngay';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Đang Ping &amp; Đọc Thử...`;
  }
  if (box) {
    box.style.display = 'block';
    box.innerHTML = `<div style="color: var(--cyan); font-size: 12px;"><span class="pulse-dot"></span> Đang kiểm tra kết nối TCP Socket tới <b>${host}:${tcpPort}</b> và gửi gói tin thăm dò Unit ID <b>${unitId}</b> (FC0${fnCode}, Addr ${testAddr}, Qty ${quantity})...</div>`;
  }

  try {
    const res = await fetch('/api/scan/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'quick_test',
        host,
        tcp_port: tcpPort,
        protocol,
        unit_id: unitId,
        fn_code: fnCode,
        test_addr: testAddr,
        quantity,
        timeout_ms: timeoutMs
      })
    });
    const data = await res.json();
    if (!box) return;

    if (!data.success) {
      box.innerHTML = `<div style="color: var(--rose); font-weight: 700;">❌ Lỗi kiểm tra TCP: ${data.error || 'Thất bại'}</div>`;
      return;
    }

    if (!data.tcp_reachable) {
      box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <span class="badge badge-rose">❌ KHÔNG KẾT NỐI ĐƯỢC CỔNG TCP</span>
            <b style="color:#fff; margin-left:6px; font-family:monospace;">${host}:${tcpPort}</b>
            <span style="color:var(--text-muted); font-size:11px; margin-left:6px;">(${data.connect_ms} ms)</span>
          </div>
        </div>
        <div style="margin-top:6px; font-size:12px; color:#fca5a5;">
          Chi tiết: <b>${data.error || 'Connection refused / Timeout'}</b>. Hãy kiểm tra lại địa chỉ IP, Port TCP (502 / 5000 / 5001..5008) hoặc bật Cầu Nối Gateway nếu đang test loopback.
        </div>
      `;
      return;
    }

    const isOk = (data.status === 'ONLINE');
    const isExc = (data.status === 'ONLINE_EXCEPTION');
    const badgeCls = isOk ? 'badge-emerald' : (isExc ? 'badge-purple' : 'badge-amber');
    const statusTxt = isOk
      ? '✅ MODBUS TCP ONLINE (Đọc Thành Công)'
      : (isExc ? '🟣 MODBUS TCP ONLINE (Báo Ngoại Lệ Exception)' : '⚠️ CỔNG TCP MỞ NHƯNG THIẾT BỊ KHÔNG TRẢ LỜI MODBUS');

    const valsHtml = (isOk && Array.isArray(data.values) && data.values.length > 0)
      ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
          ${data.values.map((v, i) => `<span style="background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); padding:3px 8px; border-radius:5px; font-family:monospace; font-size:12px; color:#a7f3d0;">[${testAddr + i}] = <b style="color:#fff;">${v}</b> <span style="color:#94a3b8;">(0x${(v & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')})</span></span>`).join('')}
         </div>`
      : '';

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="badge ${badgeCls}">${statusTxt}</span>
          <span class="badge badge-cyan" style="font-family:monospace;">${data.endpoint} • Unit ID ${unitId}</span>
          <span style="font-size:11px; color:var(--text-muted);">TCP Ping: <b style="color:var(--emerald);">${data.connect_ms} ms</b> • Modbus Latency: <b style="color:var(--cyan);">${data.latency_ms} ms</b></span>
        </div>
        <button class="btn btn-emerald" style="padding:4px 10px; font-size:11px;" onclick="openTcpTargetInPollFromScanner()">
          📊 Đưa Vào Bảng Polling
        </button>
      </div>
      <div style="margin-top:6px; font-size:12px; color:var(--text);">
        ${data.detail || data.error || ''}
      </div>
      ${valsHtml}
      <div style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(148,163,184,0.16); font-family:monospace; font-size:11px; color:#94a3b8; display:flex; gap:14px; flex-wrap:wrap;">
        <div><b style="color:var(--cyan);">TX HEX:</b> ${data.tx_hex || '--'}</div>
        <div><b style="color:var(--emerald);">RX HEX:</b> ${data.rx_hex || '(Không có phản hồi)'}</div>
      </div>
    `;
  } catch (e) {
    if (box) {
      box.innerHTML = `<div style="color: var(--rose);">Lỗi kết nối API: ${e}</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function runTcpUnitIdScan() {
  const host = (document.getElementById('inpTcpScanHost')?.value || '192.168.10.1').trim();
  const tcpPort = parseInt(document.getElementById('inpTcpScanPort')?.value) || 502;
  const protocol = (document.getElementById('selTcpScanProto')?.value || 'tcp').trim();
  const fromId = parseInt(document.getElementById('inpTcpScanFromId')?.value) || 1;
  const toId = parseInt(document.getElementById('inpTcpScanToId')?.value) || 10;
  const fnCode = parseInt(document.getElementById('selTcpScanFn')?.value) || 3;
  const testAddr = parseInt(document.getElementById('inpTcpScanAddr')?.value) || 0;
  const quantity = Math.max(1, Math.min(125, parseInt(document.getElementById('inpTcpScanQty')?.value) || 1));
  const timeoutMs = parseInt(document.getElementById('selTcpScanTimeout')?.value) || 300;
  const includeSpecial = Boolean(document.getElementById('chkTcpInclude0255')?.checked);

  const btn = document.getElementById('btnTcpUnitScan');
  const origHtml = btn ? btn.innerHTML : '🔍 Quét Dải Unit ID Qua TCP';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Đang Quét TCP...`;
  }

  renderScannerGrid(fromId, toId);
  if (includeSpecial) {
    const grid = document.getElementById('scannerGrid');
    [0, 255].forEach(spId => {
      if (grid && !document.getElementById(`slave-tile-${spId}`)) {
        const tile = document.createElement('div');
        tile.className = 'slave-tile';
        tile.id = `slave-tile-${spId}`;
        tile.innerHTML = `ID ${spId}`;
        grid.appendChild(tile);
      }
    });
  }

  const lblStatus = document.getElementById('lblScanStatus');
  const lblCount = document.getElementById('lblScanCount');
  const tbody = document.getElementById('tblDiscoveredDevices');
  if (lblStatus) {
    lblStatus.textContent = `Đang quét ${protocol === 'rtuovertcp' ? 'RTU-over-TCP' : 'Modbus TCP'} tại ${host}:${tcpPort} (Unit ID ${fromId} → ${toId}${includeSpecial ? ' + ID 0, 255' : ''}, FC0${fnCode}, Addr ${testAddr})...`;
  }
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--cyan); padding: 14px;"><span class="pulse-dot"></span> Đang thăm dò dải Unit ID qua kết nối TCP <b>${host}:${tcpPort}</b>...</td></tr>`;
  }

  try {
    const res = await fetch('/api/scan/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'unit_scan',
        host,
        tcp_port: tcpPort,
        protocol,
        start_id: fromId,
        end_id: toId,
        include_special_ids: includeSpecial,
        fn_code: fnCode,
        test_addr: testAddr,
        quantity,
        timeout_ms: timeoutMs
      })
    });
    const data = await res.json();
    if (!data.success) {
      if (lblStatus) lblStatus.textContent = `Lỗi quét TCP ${host}:${tcpPort}: ${data.error || 'Không thể kết nối'}`;
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--rose); padding: 14px;">❌ ${data.error || 'Không kết nối được cổng TCP'}</td></tr>`;
      }
      return;
    }

    lastScanResults = data.found || [];
    const okCount = lastScanResults.filter(d => d.status === 'ONLINE').length;
    const excCount = lastScanResults.filter(d => d.status === 'ONLINE_EXCEPTION').length;

    if (lblStatus) {
      lblStatus.textContent = `Hoàn tất quét TCP ${host}:${tcpPort} (Ping ${data.connect_ms}ms) • Đã thử ${data.scanned_steps} Unit ID.`;
    }
    if (lblCount) {
      lblCount.textContent = `Tìm thấy: ${lastScanResults.length} Unit ID phản hồi (${okCount} chuẩn OK, ${excCount} ngoại lệ)`;
    }

    lastScanResults.forEach(dev => {
      const el = document.getElementById(`slave-tile-${dev.id}`);
      if (el) {
        const isException = dev.status === 'ONLINE_EXCEPTION';
        el.className = isException ? 'slave-tile exception' : 'slave-tile online';
        el.innerHTML = `ID ${dev.id}<br><span style="font-size: 9px;">${host}:${tcpPort}</span>`;
        el.title = `${dev.detail} (${dev.latency}ms)`;
        el.onclick = () => applyDiscoveredDevice(dev);
      }
    });

    if (lastScanResults.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--amber); padding: 14px;">⚠️ Cổng TCP <b>${host}:${tcpPort}</b> đang MỞ (Ping ${data.connect_ms}ms), nhưng không có Unit ID nào phản hồi trong dải đã quét.</td></tr>`;
    } else {
      tbody.innerHTML = lastScanResults.map((dev, idx) => {
        const isExc = dev.status === 'ONLINE_EXCEPTION';
        const badgeClass = isExc ? 'badge-purple' : 'badge-emerald';
        const statusLabel = isExc ? 'ONLINE (Ngoại Lệ)' : 'ONLINE (Chuẩn)';
        const pLbl = dev.port_label || shortPortLabel(dev.port);
        return `
          <tr>
            <td><span class="badge badge-cyan">${pLbl}</span></td>
            <td style="font-weight: 800; font-size: 14px; color: ${isExc ? '#c084fc' : 'var(--emerald)'};">Unit ID ${dev.id}</td>
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
  } catch (e) {
    if (lblStatus) lblStatus.textContent = "Lỗi kết nối API: " + e;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function runTcpIpSubnetSweep() {
  let subnetPrefix = (document.getElementById('inpTcpSweepSubnet')?.value || '192.168.10.').trim();
  if (subnetPrefix && !subnetPrefix.endsWith('.')) subnetPrefix += '.';
  const ipStart = parseInt(document.getElementById('inpTcpSweepStart')?.value) || 1;
  const ipEnd = parseInt(document.getElementById('inpTcpSweepEnd')?.value) || 50;
  const ipRange = `${subnetPrefix}${ipStart}-${ipEnd}`;
  const portsSpec = (document.getElementById('inpTcpSweepPorts')?.value || '502, 5000, 5001-5008').trim();
  const unitIds = String(document.getElementById('inpTcpSweepUnitId')?.value || '1').trim();
  const protocol = (document.getElementById('selTcpScanProto')?.value || 'tcp').trim();
  const fnCode = parseInt(document.getElementById('selTcpScanFn')?.value) || 3;
  const testAddr = parseInt(document.getElementById('inpTcpScanAddr')?.value) || 0;
  const quantity = Math.max(1, Math.min(20, parseInt(document.getElementById('inpTcpScanQty')?.value) || 1));
  const timeoutMs = parseInt(document.getElementById('selTcpScanTimeout')?.value) || 220;

  const btn = document.getElementById('btnStartTcpIpSweep');
  const origHtml = btn ? btn.innerHTML : '📡 Quét Tìm Thiết Bị TCP Trong Mạng LAN';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Đang Quét Mạng LAN...`;
  }

  const lblStatus = document.getElementById('lblScanStatus');
  const lblCount = document.getElementById('lblScanCount');
  const tbody = document.getElementById('tblDiscoveredDevices');
  if (lblStatus) {
    lblStatus.textContent = `Đang quét đa luồng dải IP ${ipRange} trên các cổng [${portsSpec}] (Unit ID: ${unitIds})...`;
  }
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--cyan); padding: 14px;"><span class="pulse-dot"></span> Đang quét dải IP mạng LAN <b>${ipRange}</b> (Port: ${portsSpec})...</td></tr>`;
  }

  try {
    const res = await fetch('/api/scan/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'ip_sweep',
        subnet_prefix: subnetPrefix,
        ip_start: ipStart,
        ip_end: ipEnd,
        tcp_ports: portsSpec,
        unit_id: parseInt(unitIds) || 1,
        protocol,
        fn_code: fnCode,
        test_addr: testAddr,
        quantity,
        timeout_ms: timeoutMs
      })
    });
    const data = await res.json();
    if (!data.success) {
      if (lblStatus) lblStatus.textContent = "Lỗi quét dải IP: " + (data.error || "Thất bại");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--rose); padding: 14px;">${data.error}</td></tr>`;
      return;
    }

    lastScanResults = data.found || [];
    const openEndpoints = data.open_tcp_endpoints || [];
    if (lblStatus) {
      lblStatus.textContent = `Hoàn tất quét LAN! Đã kiểm tra ${data.scanned_targets} đích IP:Port → Phát hiện ${openEndpoints.length} cổng TCP mở.`;
    }
    if (lblCount) {
      lblCount.textContent = `Tìm thấy: ${lastScanResults.length} thiết bị Modbus TCP (${openEndpoints.length} cổng TCP mở)`;
    }

    if (lastScanResults.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 14px;">Không tìm thấy cổng TCP nào mở trong dải IP <b>${ipRange}</b> (Port: ${portsSpec}).</td></tr>`;
    } else {
      tbody.innerHTML = lastScanResults.map((dev, idx) => {
        const isExc = dev.status === 'ONLINE_EXCEPTION';
        const isNoMb = dev.status === 'TCP_OPEN_NO_MODBUS';
        const badgeClass = isNoMb ? 'badge-amber' : (isExc ? 'badge-purple' : 'badge-emerald');
        const statusLabel = isNoMb ? 'TCP MỞ (Chưa rõ Unit ID)' : (isExc ? 'ONLINE (Ngoại Lệ)' : 'ONLINE (Chuẩn)');
        const pLbl = dev.port_label || shortPortLabel(dev.port);
        return `
          <tr>
            <td><span class="badge badge-cyan">${pLbl}</span></td>
            <td style="font-weight: 800; font-size: 14px; color: ${isNoMb ? 'var(--amber)' : (isExc ? '#c084fc' : 'var(--emerald)')};">Unit ID ${dev.id}</td>
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
  } catch (e) {
    if (lblStatus) lblStatus.textContent = "Lỗi kết nối API: " + e;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// ==================== SCADA DYNAMIC TELEMETRY CARDS & REALTIME MULTI-TAG TREND STUDIO ====================
const TREND_PALETTE = [
  '#06b6d4', '#10b981', '#f59e0b', '#a855f7', '#ec4899',
  '#3b82f6', '#f97316', '#14b8a6', '#eab308', '#6366f1', '#84cc16', '#f43f5e'
];

let trendCanvasEventsBound = false;
let trendHoverX = null;
let trendDragCardIdx = null;
let trendPausedSnapshot = null;

function getWatchKey(tabId, addrDec) {
  return `${tabId}_${addrDec}`;
}

function findMatchingTabForWatch(w) {
  if (!w || !Array.isArray(sessionTabs)) return null;
  let tab = sessionTabs.find(t => t.id === w.tabId);
  if (tab && w.addr >= tab.start_addr && w.addr < tab.start_addr + tab.count) {
    return tab;
  }
  // Fallback match by port + slave_id + fn_code if tabs were reloaded from profile
  tab = sessionTabs.find(t =>
    t.port === w.port &&
    Number(t.slave_id) === Number(w.slave_id || 1) &&
    Number(t.fn_code) === Number(w.fn_code || 3) &&
    w.addr >= t.start_addr &&
    w.addr < t.start_addr + t.count
  );
  if (tab) {
    w.tabId = tab.id;
    return tab;
  }
  return sessionTabs.find(t => t.id === w.tabId) || sessionTabs[0] || null;
}

function syncTrendWatchesWithSessionTabs() {
  if (!Array.isArray(trendWatches)) trendWatches = [];
  trendWatches.forEach(w => {
    const tab = findMatchingTabForWatch(w);
    if (tab) {
      w.tabId = tab.id;
      w.port = tab.port;
      w.slave_id = tab.slave_id;
      w.fn_code = tab.fn_code;
      const idx = w.addr - tab.start_addr;
      if (idx >= 0 && idx < tab.count) {
        const tabTag = getPointMeta(tab.tags, idx, tab.start_addr, "");
        const tabUnit = getPointMeta(tab.units, idx, tab.start_addr, "");
        const tabScale = getPointMeta(tab.scales, idx, tab.start_addr, undefined);
        if (tabTag) w.alias = tabTag;
        if (tabUnit) w.unit = tabUnit;
        if (tabScale !== undefined) w.scale = tabScale;
      }
      w.id = getWatchKey(tab.id, w.addr);
    }
  });
}

function createWatchItemFromTabPoint(tab, idx, colorIdx) {
  const addrDec = tab.start_addr + idx;
  const rawTag = getPointMeta(tab.tags, idx, tab.start_addr, "");
  const unit = getPointMeta(tab.units, idx, tab.start_addr, "");
  const scale = getPointMeta(tab.scales, idx, tab.start_addr, 1.0);
  const usedColors = new Set((trendWatches || []).map(x => x.color));
  const color = TREND_PALETTE.find(c => !usedColors.has(c)) || TREND_PALETTE[(colorIdx || trendWatches.length) % TREND_PALETTE.length];
  return {
    id: getWatchKey(tab.id, addrDec),
    tabId: tab.id,
    port: tab.port,
    slave_id: tab.slave_id,
    fn_code: tab.fn_code,
    addr: addrDec,
    alias: rawTag || `Điểm #${addrDec}`,
    unit: unit || "",
    scale: Number(scale) || 1.0,
    color: color,
    visible: true,
    span: 1
  };
}

let trendInitialSeeded = false;
let trendWatchesUserCleared = false;

function ensureDefaultTrendWatches() {
  if (!Array.isArray(trendWatches)) trendWatches = [];
  syncTrendWatchesWithSessionTabs();
  if (trendWatches.length > 0) {
    trendInitialSeeded = true;
    return;
  }
  // Never auto-respawn tags if the user explicitly deleted or cleared them!
  if (trendWatchesUserCleared || trendInitialSeeded) return;
  const t = getActiveTab();
  if (!t) return;
  trendInitialSeeded = true;

  // Prefer writable / control or sensor registers rather than static device IDs
  const scoredCandidates = [];
  for (let i = 0; i < t.count; i++) {
    if (isRegisterDisabled(t, i)) continue;
    const rawTag = String(getPointMeta(t.tags, i, t.start_addr, "") || "").trim();
    if (!rawTag) continue;
    let priority = 10;
    if (/^(RL\d+_STATE|OUT12V_\d+_STATE|DO_BITMAP)\b/i.test(rawTag)) priority = 100;
    else if (/(TEMP|VOLT|CURR|PRESS|ADC|FREQ_HZ|POWER|FLOW|HUMID)/i.test(rawTag)) priority = 90;
    else if (/(RL\d+|OUT12V_\d+|PWM|COUNT|BITMAP)/i.test(rawTag)) priority = 70;
    else if (/(DEVICE_ID|FW_VERSION|HW_VERSION|UID_WORD|UPTIME)/i.test(rawTag)) priority = 1;
    scoredCandidates.push({ idx: i, priority });
  }
  scoredCandidates.sort((a, b) => b.priority - a.priority || a.idx - b.idx);
  const pickedIndices = scoredCandidates.length > 0
    ? scoredCandidates.slice(0, 6).map(x => x.idx)
    : Array.from({ length: Math.min(4, t.count) }, (_, i) => i);

  pickedIndices.forEach((idx, cIdx) => {
    const item = createWatchItemFromTabPoint(t, idx, cIdx);
    trendWatches.push(item);
    const raw = Array.isArray(t.values) ? t.values[idx] : undefined;
    if (raw !== undefined && raw !== null) {
      const nowStr = (t.lastUpdatedMap && t.lastUpdatedMap[idx]) || t.lastUpdated || new Date().toTimeString().split(' ')[0];
      pushWatchSamplePoint(item, t, idx, raw, nowStr);
    }
  });
  saveUiStateToStorage();
}

function pushWatchSamplePoint(w, tab, idx, rawVal, timeStr) {
  if (rawVal === undefined || rawVal === null) return;
  const scale = Number(getPointMeta(tab.scales, idx, tab.start_addr, w.scale ?? 1.0)) || 1.0;
  let numVal = Number(rawVal);
  if (tab.format === 'int16' && numVal > 32767) numVal -= 65536;
  const scaledVal = numVal * scale;
  if (!isFinite(scaledVal)) return;

  if (!trendDataSeries[w.id]) trendDataSeries[w.id] = [];
  const arr = trendDataSeries[w.id];
  arr.push({
    time: timeStr,
    timeMs: Date.now(),
    val: scaledVal,
    raw: numVal
  });
  if (arr.length > 300) arr.shift();
}

function ingestPollIntoTrendStudio(tab, timeStr) {
  if (!tab || !Array.isArray(tab.values)) return;
  if (!Array.isArray(trendWatches) || trendWatches.length === 0) return;
  const stamp = timeStr || new Date().toTimeString().split(' ')[0];
  let anyUpdated = false;

  trendWatches.forEach(w => {
    const matchedTab = findMatchingTabForWatch(w);
    if (!matchedTab || matchedTab.id !== tab.id) return;
    const idx = w.addr - tab.start_addr;
    if (idx < 0 || idx >= tab.count) return;
    const raw = tab.values[idx];
    if (raw === undefined || raw === null) return;
    pushWatchSamplePoint(w, tab, idx, raw, stamp);
    anyUpdated = true;
  });

  if (anyUpdated && currentView === 'trend' && !trendIsPaused) {
    updateTrendCardsLiveValuesInPlace();
  }
}

function pushTrendRecord(vals) {
  const t = getActiveTab();
  if (t) ingestPollIntoTrendStudio(t);
}

function toggleTrendWatchItem(tab, idx) {
  if (!tab) return;
  const addrDec = tab.start_addr + idx;
  const existingIdx = trendWatches.findIndex(w => w.tabId === tab.id && Number(w.addr) === Number(addrDec));
  if (existingIdx >= 0) {
    const removed = trendWatches.splice(existingIdx, 1)[0];
    showToast(`Đã gỡ [${removed.alias}] khỏi Bảng Thẻ Động & Biểu Đồ Trend.`);
  } else {
    const item = createWatchItemFromTabPoint(tab, idx, trendWatches.length);
    trendWatches.push(item);
    const raw = Array.isArray(tab.values) ? tab.values[idx] : undefined;
    if (raw !== undefined && raw !== null) {
      const stamp = (tab.lastUpdatedMap && tab.lastUpdatedMap[idx]) || tab.lastUpdated || new Date().toTimeString().split(' ')[0];
      pushWatchSamplePoint(item, tab, idx, raw, stamp);
    }
    showToast(`📈 Đã ghim [${item.alias}] vào Bảng Thẻ Động & Biểu Đồ Trend!`);
  }
  saveUiStateToStorage();
  if (currentView === 'trend') renderTrendStudioView();
}

function autoPopulateTrendFromActiveTab() {
  const t = getActiveTab();
  if (!t) return;
  let added = 0;
  for (let i = 0; i < t.count; i++) {
    if (isRegisterDisabled(t, i)) continue;
    const rawTag = getPointMeta(t.tags, i, t.start_addr, "");
    if (!rawTag || !String(rawTag).trim()) continue;
    const addrDec = t.start_addr + i;
    if (!trendWatches.some(w => w.tabId === t.id && Number(w.addr) === Number(addrDec))) {
      const item = createWatchItemFromTabPoint(t, i, trendWatches.length);
      trendWatches.push(item);
      const raw = Array.isArray(t.values) ? t.values[i] : undefined;
      if (raw !== undefined && raw !== null) {
        const stamp = (t.lastUpdatedMap && t.lastUpdatedMap[i]) || t.lastUpdated || new Date().toTimeString().split(' ')[0];
        pushWatchSamplePoint(item, t, i, raw, stamp);
      }
      added++;
      if (trendWatches.length >= 16) break;
    }
  }
  if (added === 0 && trendWatches.length === 0) {
    for (let i = 0; i < Math.min(6, t.count); i++) {
      if (isRegisterDisabled(t, i)) continue;
      const item = createWatchItemFromTabPoint(t, i, trendWatches.length);
      trendWatches.push(item);
      added++;
    }
  }
  saveUiStateToStorage();
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
  showToast(`⚡ Đã nạp ${added} Tag từ '${t.name}' lên Bảng Thẻ Động & Biểu Đồ!`);
}

function ensureTrendWatchedTabsPolling() {
  const watchedTabIds = new Set(trendWatches.map(w => {
    const tb = findMatchingTabForWatch(w);
    return tb ? tb.id : w.tabId;
  }));
  if (watchedTabIds.size === 0 && sessionTabs[0]) {
    watchedTabIds.add(sessionTabs[0].id);
  }
  let startedCount = 0;
  const watchedTabs = sessionTabs.filter(t => watchedTabIds.has(t.id));
  const allAlreadyPolling = watchedTabs.length > 0 && watchedTabs.every(t => t.isPolling);

  if (allAlreadyPolling) {
    watchedTabs.forEach(t => {
      if (t.timer) clearInterval(t.timer);
      t.timer = null;
      t.isPolling = false;
    });
    renderTabs(true);
    renderTrendStudioView();
    showToast("⏹ Đã tạm dừng Polling các Tab đang theo dõi.");
    return;
  }

  watchedTabs.forEach((t, idx) => {
    if (!t.isPolling) {
      t.isPolling = true;
      startedCount++;
      setTimeout(() => {
        if (t.isPolling) {
          executePoll(t);
          t.timer = setInterval(() => executePoll(t), t.scan_ms || 1000);
        }
      }, idx * 45);
    } else {
      executePoll(t);
    }
  });
  renderTabs(true);
  renderTrendStudioView();
  showToast(`▶ Đã bật Polling thời gian thực cho ${watchedTabs.length} Tab đang theo dõi!`);
}

function setTrendStudioDisplayMode(mode) {
  trendStudioDisplayMode = mode || 'both';
  ['both', 'cards', 'chart'].forEach(m => {
    const btn = document.getElementById(`btnTrendMode_${m}`);
    if (btn) btn.className = (m === trendStudioDisplayMode) ? 'btn btn-primary' : 'btn btn-outline';
  });
  const cardsSec = document.getElementById('trendCardsSection');
  const chartSec = document.getElementById('trendChartSection');
  if (cardsSec) cardsSec.style.display = (trendStudioDisplayMode === 'chart') ? 'none' : 'flex';
  if (chartSec) chartSec.style.display = (trendStudioDisplayMode === 'cards') ? 'none' : 'flex';
  saveUiStateToStorage();
  if (trendStudioDisplayMode !== 'cards') {
    setTimeout(() => drawTrendCanvas(), 20);
  }
}

function setTrendGridColumns(colsVal) {
  trendGridCols = colsVal || 'auto';
  const grid = document.getElementById('trendDynamicCardsGrid');
  if (grid) {
    grid.className = 'scada-telemetry-grid' + (trendGridCols !== 'auto' ? ` cols-${trendGridCols}` : '');
  }
  const sel = document.getElementById('selTrendGridCols');
  if (sel && sel.value !== String(trendGridCols)) sel.value = String(trendGridCols);
  saveUiStateToStorage();
}

function setTrendWindowPoints(pts) {
  trendWindowPoints = Math.max(15, Math.min(300, parseInt(pts) || 60));
  const sel = document.getElementById('selTrendWindowPts');
  if (sel) {
    const opts = [30, 60, 120, 300];
    if (opts.includes(trendWindowPoints)) sel.value = String(trendWindowPoints);
  }
  saveUiStateToStorage();
  drawTrendCanvas();
}

function zoomTrendWindow(delta) {
  setTrendWindowPoints((trendWindowPoints || 60) + delta);
}

function toggleTrendNormalizedScale() {
  trendNormalizedScale = !trendNormalizedScale;
  const btn = document.getElementById('btnTrendScaleMode');
  if (btn) {
    btn.className = trendNormalizedScale ? 'btn btn-primary' : 'btn btn-outline';
    btn.innerHTML = trendNormalizedScale ? '⚖️ Thang % (0-100%)' : '⚖️ Thang Tuyệt Đối';
  }
  saveUiStateToStorage();
  drawTrendCanvas();
}

function toggleTrendPause() {
  trendIsPaused = !trendIsPaused;
  if (trendIsPaused) {
    trendPausedSnapshot = JSON.parse(JSON.stringify(trendDataSeries));
  } else {
    trendPausedSnapshot = null;
  }
  const btn = document.getElementById('btnTrendPause');
  if (btn) {
    btn.className = trendIsPaused ? 'btn btn-rose' : 'btn btn-outline';
    btn.innerHTML = trendIsPaused ? '▶ Tiếp Tục Live' : '⏸ Tạm Dừng';
  }
  renderTrendStudioView();
}

function clearTrendHistoryData() {
  trendDataSeries = {};
  trendPausedSnapshot = null;
  renderTrendStudioView();
  showToast("🗑️ Đã xóa lịch sử mẫu đo trên Biểu Đồ Sóng.");
}

function exportTrendHistoryCsv() {
  if (!Array.isArray(trendWatches) || trendWatches.length === 0) {
    alert("Chưa có Tag nào đang được theo dõi để xuất CSV.");
    return;
  }
  const headers = ['Timestamp', ...trendWatches.map(w => `"${w.alias} (Addr ${w.addr})${w.unit ? ' [' + w.unit + ']' : ''}"`)];
  const lines = [headers.join(',')];

  // Find longest series
  let baseSeries = [];
  trendWatches.forEach(w => {
    const s = trendDataSeries[w.id] || [];
    if (s.length > baseSeries.length) baseSeries = s;
  });

  if (baseSeries.length === 0) {
    // Export current snapshot row if no time series yet
    const nowStr = new Date().toTimeString().split(' ')[0];
    const row = [nowStr];
    trendWatches.forEach(w => {
      const snap = getLiveWatchSnapshot(w);
      row.push(snap.displayVal !== '--' ? snap.displayVal : '');
    });
    lines.push(row.join(','));
  } else {
    baseSeries.forEach((pt, idx) => {
      const row = [pt.time];
      trendWatches.forEach(w => {
        const s = trendDataSeries[w.id] || [];
        const offsetIdx = idx - (baseSeries.length - s.length);
        row.push(offsetIdx >= 0 && s[offsetIdx] ? s[offsetIdx].val : '');
      });
      lines.push(row.join(','));
    });
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Trend_SCADA_${currentProfileName || 'Modbus'}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  showToast("📥 Đã xuất dữ liệu các kênh theo dõi ra file CSV!");
}

function getLiveWatchSnapshot(w) {
  const tab = findMatchingTabForWatch(w);
  if (!tab) {
    return {
      tab: null, idx: -1, raw: undefined, hasVal: false,
      alias: w.alias || `Addr ${w.addr}`, unit: w.unit || '', scale: w.scale || 1,
      displayVal: '--', rawHex: '--', updatedAt: '--',
      decoded: null, quickCtrlHtml: '',
      min: null, max: null, avg: null, samplesCount: 0
    };
  }
  const idx = w.addr - tab.start_addr;
  const inRange = (idx >= 0 && idx < tab.count);
  const raw = (inRange && Array.isArray(tab.values)) ? tab.values[idx] : undefined;
  const hasVal = (raw !== undefined && raw !== null);
  const alias = (inRange ? getPointMeta(tab.tags, idx, tab.start_addr, "") : "") || w.alias || `Điểm #${w.addr}`;
  const unit = (inRange ? getPointMeta(tab.units, idx, tab.start_addr, "") : "") || w.unit || "";
  const scale = inRange ? getPointMeta(tab.scales, idx, tab.start_addr, w.scale ?? 1.0) : (w.scale ?? 1.0);
  w.alias = alias;
  w.unit = unit;
  w.scale = scale;

  const displayVal = hasVal ? formatValue(raw, tab.format, scale) : '--';
  const rawHex = hasVal ? ("0x" + (Number(raw) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")) : '--';
  const updatedAt = (inRange && tab.lastUpdatedMap && tab.lastUpdatedMap[idx])
    ? tab.lastUpdatedMap[idx]
    : (hasVal && tab.lastUpdated ? tab.lastUpdated : '--');
  const decoded = inRange ? decodeRegisterStateInfo(tab, idx, raw) : null;
  const quickCtrlHtml = inRange ? buildQuickControlCellHtml(tab, idx, raw, false, 'scada_card') : '';

  const series = (trendIsPaused && trendPausedSnapshot ? trendPausedSnapshot[w.id] : trendDataSeries[w.id]) || [];
  let min = null, max = null, avg = null;
  if (series.length > 0) {
    const vals = series.map(p => p.val);
    min = Math.min(...vals);
    max = Math.max(...vals);
    avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  } else if (hasVal) {
    const numV = parseFloat(displayVal);
    if (!isNaN(numV)) { min = numV; max = numV; avg = numV; }
  }

  return {
    tab, idx, raw, hasVal, alias, unit, scale,
    displayVal, rawHex, updatedAt, decoded, quickCtrlHtml,
    min, max, avg, samplesCount: series.length
  };
}

function moveTrendWatchCard(index, delta, ev) {
  if (ev) ev.stopPropagation();
  const target = index + delta;
  if (target < 0 || target >= trendWatches.length) return;
  const tmp = trendWatches[index];
  trendWatches[index] = trendWatches[target];
  trendWatches[target] = tmp;
  saveUiStateToStorage();
  renderTrendStudioView();
  if (document.getElementById('trendTagManagerModal')?.classList.contains('open')) {
    renderTrendWatchedTableInModal();
  }
}

function toggleTrendWatchCardSpan(index, ev) {
  if (ev) ev.stopPropagation();
  const w = trendWatches[index];
  if (!w) return;
  w.span = (w.span === 2) ? 1 : 2;
  saveUiStateToStorage();
  renderTrendStudioView();
  if (document.getElementById('trendTagManagerModal')?.classList.contains('open')) {
    renderTrendWatchedTableInModal();
  }
}

function toggleTrendWatchVisibility(index, ev) {
  if (ev) ev.stopPropagation();
  const w = trendWatches[index];
  if (!w) return;
  w.visible = (w.visible === false) ? true : false;
  saveUiStateToStorage();
  renderTrendStudioView();
  if (document.getElementById('trendTagManagerModal')?.classList.contains('open')) {
    renderTrendWatchedTableInModal();
  }
}

function removeTrendWatchByIndex(index, ev) {
  if (ev) ev.stopPropagation();
  const w = trendWatches[index];
  if (!w) return;
  trendWatches.splice(index, 1);
  if (trendWatches.length === 0) {
    trendWatchesUserCleared = true;
  }
  saveUiStateToStorage();
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
  if (document.getElementById('trendTagManagerModal')?.classList.contains('open')) {
    renderTrendTagManagerPickerList();
    renderTrendWatchedTableInModal();
  }
}

function editTrendWatchCardPrompt(index, ev) {
  if (ev) ev.stopPropagation();
  const w = trendWatches[index];
  if (!w) return;
  const snap = getLiveWatchSnapshot(w);
  const curSpec = `${snap.alias}:${snap.unit}:${snap.scale}`;
  const input = prompt(
    `Chỉnh sửa Thẻ Động & Tag (Addr ${w.addr}):\n` +
    `Nhập theo cú pháp: Tên_Tag:Đơn_vị:Hệ_số\n` +
    `(VD: Nhiệt độ đầu nén:°C:0.1 hoặc RL1_STATE (0=OFF,1=ON,2=Toggle)::1)`,
    curSpec
  );
  if (input === null) return;
  const parts = input.trim().split(':');
  if (parts[0] && parts[0].trim()) {
    w.alias = parts[0].trim();
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.tags, snap.idx, snap.tab.start_addr, w.alias);
  }
  if (parts.length >= 2) {
    w.unit = parts[1].trim();
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.units, snap.idx, snap.tab.start_addr, w.unit);
  }
  if (parts.length >= 3 && !isNaN(parseFloat(parts[2]))) {
    w.scale = parseFloat(parts[2]);
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.scales, snap.idx, snap.tab.start_addr, w.scale);
  }
  saveUiStateToStorage();
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
}

function onTrendCardDragStart(idx, ev) {
  trendDragCardIdx = idx;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', String(idx)); } catch (e) {}
  }
}

function onTrendCardDragOver(idx, el, ev) {
  ev.preventDefault();
  if (el) el.classList.add('drag-over');
}

function onTrendCardDragLeave(el) {
  if (el) el.classList.remove('drag-over');
}

function onTrendCardDrop(targetIdx, el, ev) {
  ev.preventDefault();
  if (el) el.classList.remove('drag-over');
  if (trendDragCardIdx === null || trendDragCardIdx === targetIdx) return;
  const item = trendWatches.splice(trendDragCardIdx, 1)[0];
  trendWatches.splice(targetIdx, 0, item);
  trendDragCardIdx = null;
  saveUiStateToStorage();
  renderTrendStudioView();
}

function computeTrendCardsGridSig() {
  if (!Array.isArray(trendWatches) || trendWatches.length === 0) return "EMPTY";
  return trendWatches.map(w => `${w.id}:${w.alias}:${w.unit}:${w.scale}:${w.color}:${w.span || 1}:${w.visible !== false ? 1 : 0}`).join('|');
}

function updateTrendCardsLiveValuesInPlace() {
  const grid = document.getElementById('trendDynamicCardsGrid');
  if (!grid) return;
  if (grid.dataset.renderedSig !== computeTrendCardsGridSig()) {
    renderTrendStudioView();
    return;
  }

  let maxSamples = 0;
  trendWatches.forEach((w, idx) => {
    const len = (trendDataSeries[w.id] || []).length;
    if (len > maxSamples) maxSamples = len;
    const snap = getLiveWatchSnapshot(w);
    const hasDecimals = Math.abs((Number(snap.scale) || 1) - 1) > 1e-9;
    const fmtStat = v => (v === null || v === undefined) ? '--' : Number(v).toFixed(hasDecimals ? 2 : 0);

    const valEl = document.getElementById(`trendCardVal_${idx}`);
    if (valEl && valEl.textContent !== String(snap.displayVal)) {
      valEl.textContent = snap.displayVal;
    }

    const decEl = document.getElementById(`trendCardDecoded_${idx}`);
    if (decEl) {
      const decHtml = snap.decoded
        ? `<span class="decoded-state-pill tone-${snap.decoded.tone}" title="Trạng thái giải mã trực tiếp">${escapeHtmlStr(snap.decoded.badgeText)}</span>`
        : '';
      if (decEl.innerHTML !== decHtml) decEl.innerHTML = decHtml;
    }

    const ctrlBox = document.getElementById(`trendCardCtrl_${idx}`);
    if (ctrlBox && snap.tab && snap.idx >= 0 && typeof patchQuickControlLiveState === 'function') {
      patchQuickControlLiveState(ctrlBox, snap.tab, snap.idx, snap.raw);
    }

    const timeEl = document.getElementById(`trendCardTime_${idx}`);
    if (timeEl) {
      timeEl.style.color = snap.updatedAt !== '--' ? '#38bdf8' : '#64748b';
      const timeHtml = `🕒 Cập nhật: <b>${snap.updatedAt}</b>`;
      if (timeEl.innerHTML !== timeHtml) timeEl.innerHTML = timeHtml;
    }

    const statsEl = document.getElementById(`trendCardStats_${idx}`);
    if (statsEl) {
      const statsHtml = `Min: <b style="color: #cbd5e1;">${fmtStat(snap.min)}</b> • Max: <b style="color: #cbd5e1;">${fmtStat(snap.max)}</b> • TB: <b style="color: #cbd5e1;">${fmtStat(snap.avg)}</b>`;
      if (statsEl.innerHTML !== statsHtml) statsEl.innerHTML = statsHtml;
    }

    const legValEl = document.getElementById(`trendLegendVal_${idx}`);
    if (legValEl) {
      const lTxt = `${snap.displayVal}${snap.unit ? ' ' + snap.unit : ''}`;
      if (legValEl.textContent !== lTxt) legValEl.textContent = lTxt;
    }
  });

  const smpBadge = document.getElementById('badgeTrendSampleCount');
  if (smpBadge) smpBadge.textContent = `${maxSamples} mẫu lịch sử`;

  drawTrendCanvas();
}

function renderTrendDynamicCardsGrid() {
  const grid = document.getElementById('trendDynamicCardsGrid');
  if (!grid) return;
  grid.className = 'scada-telemetry-grid' + (trendGridCols !== 'auto' ? ` cols-${trendGridCols}` : '');
  grid.dataset.renderedSig = computeTrendCardsGridSig();

  if (!Array.isArray(trendWatches) || trendWatches.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 26px 16px; background: rgba(2,6,23,0.65); border: 1px dashed var(--border); border-radius: 12px; color: var(--text-muted);">
        <div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px;">Chưa có Thẻ Động hoặc Tag nào đang được theo dõi</div>
        <div style="font-size: 12px; margin-bottom: 12px;">Nhấn <b>➕ Thêm / Chọn Tag Theo Dõi</b> hoặc <b>⚡ Nạp Nhanh Tag Đang Mở</b> để tạo lưới thẻ động thời gian thực và vẽ đồ thị sóng.</div>
        <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-emerald" onclick="openTrendTagManagerModal()">➕ Chọn Tag Theo Dõi</button>
          <button class="btn btn-primary" onclick="autoPopulateTrendFromActiveTab()">⚡ Nạp Nhanh Tag Đang Mở</button>
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = trendWatches.map((w, idx) => {
    const snap = getLiveWatchSnapshot(w);
    const pLbl = snap.tab ? shortPortLabel(snap.tab.port) : shortPortLabel(w.port);
    const plcPrefix = (w.fn_code === 3) ? 40001 : (w.fn_code === 4) ? 30001 : (w.fn_code === 1) ? 1 : 10001;
    const plcAddr = plcPrefix + Number(w.addr);
    const hasDecimals = Math.abs((Number(snap.scale) || 1) - 1) > 1e-9;
    const fmtStat = v => (v === null || v === undefined) ? '--' : Number(v).toFixed(hasDecimals ? 2 : 0);
    const decodedHtml = snap.decoded
      ? `<span class="decoded-state-pill tone-${snap.decoded.tone}" title="Trạng thái giải mã trực tiếp">${escapeHtmlStr(snap.decoded.badgeText)}</span>`
      : '';

    return `
      <div id="trendCard_${idx}" class="scada-dyn-card ${w.span === 2 ? 'span-2' : ''}"
           draggable="true"
           ondragstart="onTrendCardDragStart(${idx}, event)"
           ondragover="onTrendCardDragOver(${idx}, this, event)"
           ondragleave="onTrendCardDragLeave(this)"
           ondrop="onTrendCardDrop(${idx}, this, event)"
           style="border-top: 3px solid ${w.color || '#06b6d4'};">
        <!-- Card Header: Tag Name + Source Badge + Grid Reorder/Edit/Delete Controls -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
              <span style="width: 9px; height: 9px; border-radius: 50%; background: ${w.color || '#06b6d4'}; display: inline-block; flex-shrink: 0;"></span>
              <span style="font-size: 10px; font-family: monospace; color: var(--cyan); background: rgba(6,182,212,0.12); padding: 1px 5px; border-radius: 4px;">${escapeHtmlStr(pLbl)} • #${plcAddr} (Addr ${w.addr})</span>
            </div>
            <div style="font-size: 13px; font-weight: 800; color: #f8fafc; margin-top: 4px; line-height: 1.25; word-break: break-word;" title="${escapeHtmlStr(snap.alias)}">
              ${escapeHtmlStr(snap.alias)}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 2px; flex-shrink: 0;">
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px;" onclick="moveTrendWatchCard(${idx}, -1, event)" title="Di chuyển thẻ sang trái / lên trên theo lưới">◀</button>
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px;" onclick="moveTrendWatchCard(${idx}, 1, event)" title="Di chuyển thẻ sang phải / xuống dưới theo lưới">▶</button>
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px; color: ${w.span === 2 ? 'var(--cyan)' : 'var(--text-muted)'};" onclick="toggleTrendWatchCardSpan(${idx}, event)" title="Đổi kích thước thẻ trên lưới (1 cột / 2 cột)">${w.span === 2 ? '2x' : '1x'}</button>
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px;" onclick="editTrendWatchCardPrompt(${idx}, event)" title="Sửa nhanh Tên Tag, Đơn vị & Hệ số">✏️</button>
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px; color: var(--rose);" onclick="removeTrendWatchByIndex(${idx}, event)" title="Gỡ thẻ này khỏi bảng theo dõi">✕</button>
          </div>
        </div>

        <!-- Card Body: Big Realtime Value + Decoded State + Quick Control -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin: 2px 0;">
          <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
            <span id="trendCardVal_${idx}" class="scada-card-val" style="color: ${w.color || '#38bdf8'};">${snap.displayVal}</span>
            ${snap.unit ? `<span style="font-size: 13px; font-weight: 800; color: #cbd5e1;">${escapeHtmlStr(snap.unit)}</span>` : ''}
            <span id="trendCardDecoded_${idx}">${decodedHtml}</span>
          </div>
          <div id="trendCardCtrl_${idx}" style="flex-shrink: 0;">
            ${snap.quickCtrlHtml}
          </div>
        </div>

        <!-- Card Footer: Update Timestamp + Min/Max/Avg Stats -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 10px; color: var(--text-muted); border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
          <span id="trendCardTime_${idx}" style="font-family: monospace; color: ${snap.updatedAt !== '--' ? '#38bdf8' : '#64748b'};" title="Thời điểm cập nhật giá trị gần nhất">
            🕒 Cập nhật: <b>${snap.updatedAt}</b>
          </span>
          <span id="trendCardStats_${idx}" style="font-family: monospace;">
            Min: <b style="color: #cbd5e1;">${fmtStat(snap.min)}</b> • Max: <b style="color: #cbd5e1;">${fmtStat(snap.max)}</b> • TB: <b style="color: #cbd5e1;">${fmtStat(snap.avg)}</b>
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTrendLegendBar() {
  const bar = document.getElementById('trendLegendBar');
  if (!bar) return;
  if (!Array.isArray(trendWatches) || trendWatches.length === 0) {
    bar.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">Chưa có kênh sóng nào. Nhấn <b>➕ Thêm / Chọn Tag Theo Dõi</b> để chọn thanh ghi cần vẽ đồ thị.</span>`;
    return;
  }

  bar.innerHTML = `<span style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-right: 4px;">KÊNH ĐỒ THỊ:</span>` +
    trendWatches.map((w, idx) => {
      const snap = getLiveWatchSnapshot(w);
      const isVis = w.visible !== false;
      return `
        <div class="trend-legend-pill ${isVis ? '' : 'is-hidden'}">
          <input type="checkbox" ${isVis ? 'checked' : ''} onchange="toggleTrendWatchVisibility(${idx}, event)" style="accent-color: ${w.color}; cursor: pointer;" title="Bật/Tắt vẽ đường sóng này">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${w.color}; display: inline-block;"></span>
          <span style="font-weight: 700; color: #e2e8f0; cursor: pointer;" onclick="toggleTrendWatchVisibility(${idx}, event)">${escapeHtmlStr(snap.alias)}</span>
          <span id="trendLegendVal_${idx}" style="font-family: monospace; font-weight: 800; color: ${w.color};">${snap.displayVal}${snap.unit ? ' ' + escapeHtmlStr(snap.unit) : ''}</span>
          <button style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 10px; padding: 0 2px;" onclick="removeTrendWatchByIndex(${idx}, event)" title="Xóa kênh này">✕</button>
        </div>
      `;
    }).join('');
}

function renderTrendStudioView() {
  syncTrendWatchesWithSessionTabs();
  const cntBadge = document.getElementById('badgeTrendWatchCount');
  if (cntBadge) cntBadge.textContent = `${trendWatches.length} Tag theo dõi`;

  let maxSamples = 0;
  trendWatches.forEach(w => {
    const len = (trendDataSeries[w.id] || []).length;
    if (len > maxSamples) maxSamples = len;
  });
  const smpBadge = document.getElementById('badgeTrendSampleCount');
  if (smpBadge) smpBadge.textContent = `${maxSamples} mẫu lịch sử`;

  const btnPoll = document.getElementById('btnTrendStartPoll');
  if (btnPoll) {
    const anyPolling = sessionTabs.some(t => t.isPolling);
    btnPoll.className = anyPolling ? 'btn btn-rose' : 'btn btn-emerald';
    btnPoll.innerHTML = anyPolling ? '⏹ Dừng Polling' : '▶ Bật Polling Các Tag';
  }

  setTrendStudioDisplayMode(trendStudioDisplayMode);
  setTrendGridColumns(trendGridCols);
  renderTrendDynamicCardsGrid();
  renderTrendLegendBar();
  drawTrendCanvas();
}

function initTrendCanvas() {
  bindTrendCanvasEventsOnce();
  ensureDefaultTrendWatches();
  renderTrendStudioView();
}

function bindTrendCanvasEventsOnce() {
  if (trendCanvasEventsBound) return;
  const cvs = document.getElementById('trendCanvas');
  if (!cvs) return;
  trendCanvasEventsBound = true;

  cvs.addEventListener('mousemove', ev => {
    const rect = cvs.getBoundingClientRect();
    trendHoverX = ev.clientX - rect.left;
    drawTrendCanvas();
  });
  cvs.addEventListener('mouseleave', () => {
    trendHoverX = null;
    const tt = document.getElementById('trendHoverTooltip');
    if (tt) tt.style.display = 'none';
    drawTrendCanvas();
  });
  cvs.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoomTrendWindow(ev.deltaY < 0 ? -15 : 15);
  }, { passive: false });
}

function drawTrendCanvas() {
  const cvs = document.getElementById('trendCanvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = cvs.clientWidth || 700;
  const h = cvs.clientHeight || 340;
  cvs.width = w * dpr;
  cvs.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);

  const pad = { top: 22, right: 64, bottom: 28, left: 18 };
  const plotW = Math.max(100, w - pad.left - pad.right);
  const plotH = Math.max(80, h - pad.top - pad.bottom);

  // Compute global Y range across visible watches
  const activeSeriesMap = trendIsPaused && trendPausedSnapshot ? trendPausedSnapshot : trendDataSeries;
  const visibleWatches = (trendWatches || []).filter(tw => tw.visible !== false);
  const winPts = trendWindowPoints || 60;

  let globalMin = Infinity, globalMax = -Infinity;
  let longestWindow = [];

  visibleWatches.forEach(tw => {
    const fullArr = activeSeriesMap[tw.id] || [];
    const sliced = fullArr.slice(-winPts);
    if (sliced.length > longestWindow.length) longestWindow = sliced;
    sliced.forEach(pt => {
      if (pt.val < globalMin) globalMin = pt.val;
      if (pt.val > globalMax) globalMax = pt.val;
    });
  });

  if (!isFinite(globalMin) || !isFinite(globalMax)) {
    globalMin = 0; globalMax = 100;
  } else if (Math.abs(globalMax - globalMin) < 1e-6) {
    globalMin -= 5; globalMax += 5;
  } else {
    const margin = (globalMax - globalMin) * 0.1;
    globalMin -= margin;
    globalMax += margin;
  }

  // Draw Horizontal Grid Lines & Y-Axis Labels
  const gridRows = 5;
  ctx.font = '10px monospace';
  for (let r = 0; r <= gridRows; r++) {
    const ratio = r / gridRows;
    const y = pad.top + ratio * plotH;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();

    const lblVal = trendNormalizedScale
      ? `${Math.round((1 - ratio) * 100)}%`
      : (globalMax - ratio * (globalMax - globalMin)).toFixed(Math.abs(globalMax - globalMin) < 10 ? 2 : 0);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(lblVal, pad.left + plotW + 6, y + 3);
  }

  // Draw X-Axis Time Labels
  if (longestWindow.length > 0) {
    ctx.fillStyle = '#64748b';
    const step = Math.max(1, Math.floor(longestWindow.length / 5));
    for (let i = 0; i < longestWindow.length; i += step) {
      const x = longestWindow.length === 1
        ? pad.left + plotW / 2
        : pad.left + (i / (longestWindow.length - 1)) * plotW;
      ctx.textAlign = (i === 0 && longestWindow.length > 1)
        ? 'left'
        : (i + step >= longestWindow.length && longestWindow.length > 1 ? 'right' : 'center');
      ctx.fillText(longestWindow[i].time, x, h - 8);
    }
  } else {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("Đang chờ mẫu dữ liệu Polling... (Nhấn '▶ Bật Polling Các Tag' hoặc 'Đọc 1 Lần')", pad.left + plotW / 2, pad.top + plotH / 2);
  }

  // Draw Each Visible Trace Curve
  visibleWatches.forEach(tw => {
    const fullArr = activeSeriesMap[tw.id] || [];
    const sliced = fullArr.slice(-winPts);
    if (sliced.length === 0) return;

    let tMin = globalMin, tMax = globalMax;
    if (trendNormalizedScale) {
      const vals = sliced.map(p => p.val);
      tMin = Math.min(...vals);
      tMax = Math.max(...vals);
      if (Math.abs(tMax - tMin) < 1e-6) { tMin -= 1; tMax += 1; }
    }

    ctx.strokeStyle = tw.color || '#06b6d4';
    ctx.lineWidth = 2.2;
    ctx.beginPath();

    const coords = sliced.map((pt, i) => {
      const x = sliced.length === 1
        ? pad.left + plotW / 2
        : pad.left + (i / (sliced.length - 1)) * plotW;
      const norm = (pt.val - tMin) / (tMax - tMin);
      const y = pad.top + plotH - Math.max(0, Math.min(1, norm)) * plotH;
      return { x, y, pt };
    });

    coords.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();

    // Draw latest point dot
    const last = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = tw.color || '#06b6d4';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Draw Crosshair & Floating Tooltip on Hover
  const tt = document.getElementById('trendHoverTooltip');
  if (trendHoverX !== null && longestWindow.length > 0 && trendHoverX >= pad.left && trendHoverX <= pad.left + plotW) {
    const ratio = (trendHoverX - pad.left) / plotW;
    const hoverIdx = Math.max(0, Math.min(longestWindow.length - 1, Math.round(ratio * (longestWindow.length - 1))));
    const snapX = longestWindow.length === 1
      ? pad.left + plotW / 2
      : pad.left + (hoverIdx / (longestWindow.length - 1)) * plotW;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(snapX, pad.top);
    ctx.lineTo(snapX, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const hoverTime = longestWindow[hoverIdx]?.time || '--';
    const rowsHtml = [];
    visibleWatches.forEach(tw => {
      const s = (activeSeriesMap[tw.id] || []).slice(-winPts);
      const localIdx = hoverIdx - (longestWindow.length - s.length);
      if (localIdx >= 0 && localIdx < s.length) {
        const p = s[localIdx];
        rowsHtml.push(`
          <div style="display: flex; justify-content: space-between; gap: 10px; align-items: center;">
            <span style="color: #e2e8f0; display: inline-flex; align-items: center; gap: 4px;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: ${tw.color}; display: inline-block;"></span>
              ${escapeHtmlStr(tw.alias)}
            </span>
            <b style="color: ${tw.color};">${Number(p.val).toFixed(Math.abs((tw.scale || 1) - 1) > 1e-9 ? 2 : 0)} ${escapeHtmlStr(tw.unit || '')}</b>
          </div>
        `);
      }
    });

    if (tt && rowsHtml.length > 0) {
      tt.style.display = 'block';
      tt.style.left = `${Math.min(w - 230, Math.max(10, snapX + 12))}px`;
      tt.style.top = `14px`;
      tt.innerHTML = `
        <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px; color: var(--cyan); font-weight: 700;">
          🕒 Mốc thời gian: ${hoverTime}
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          ${rowsHtml.join('')}
        </div>
      `;
    }
  } else if (tt) {
    tt.style.display = 'none';
  }
}

// ==================== TREND TAG MANAGER MODAL (ADD / EDIT / DELETE / SELECT TAGS) ====================
function openTrendTagManagerModal() {
  const modal = document.getElementById('trendTagManagerModal');
  if (!modal) return;
  const selTab = document.getElementById('selTrendMgrTab');
  if (selTab) {
    selTab.innerHTML = (sessionTabs || []).map(t =>
      `<option value="${t.id}" ${t.id === activeTabId ? 'selected' : ''}>${escapeHtmlStr(t.name)} (${shortPortLabel(t.port)} • ID:${t.slave_id} • Addr ${t.start_addr}..${t.start_addr + t.count - 1})</option>`
    ).join('');
  }
  renderTrendTagManagerPickerList();
  renderTrendWatchedTableInModal();
  modal.classList.add('open');
}

function closeTrendTagManagerModal() {
  const modal = document.getElementById('trendTagManagerModal');
  if (modal) modal.classList.remove('open');
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
}

function renderTrendTagManagerPickerList() {
  const box = document.getElementById('trendMgrPickerGrid');
  if (!box) return;
  const tabId = document.getElementById('selTrendMgrTab')?.value || activeTabId;
  const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
  if (!tab) return;

  const q = (document.getElementById('inpTrendMgrSearch')?.value || '').trim().toLowerCase();
  const onlyNamed = Boolean(document.getElementById('chkTrendMgrOnlyNamed')?.checked);
  const plcPrefix = (tab.fn_code === 3) ? 40001 : (tab.fn_code === 4) ? 30001 : (tab.fn_code === 1) ? 1 : 10001;

  const itemsHtml = [];
  for (let i = 0; i < tab.count; i++) {
    if (isRegisterDisabled(tab, i)) continue;
    const addrDec = tab.start_addr + i;
    const plcAddr = plcPrefix + addrDec;
    const rawTag = getPointMeta(tab.tags, i, tab.start_addr, "");
    if (onlyNamed && (!rawTag || !String(rawTag).trim())) continue;
    const label = rawTag || `Điểm #${addrDec}`;
    if (q && !label.toLowerCase().includes(q) && !String(addrDec).includes(q) && !String(plcAddr).includes(q)) {
      continue;
    }
    const isWatched = isPointWatchedInTrend(tab.id, addrDec);
    const raw = Array.isArray(tab.values) ? tab.values[i] : undefined;
    const scale = getPointMeta(tab.scales, i, tab.start_addr, 1.0);
    const unit = getPointMeta(tab.units, i, tab.start_addr, "");
    const valStr = (raw !== undefined && raw !== null) ? formatValue(raw, tab.format, scale) : '--';

    itemsHtml.push(`
      <div class="trend-picker-item ${isWatched ? 'is-watched' : ''}" onclick="toggleTrendPickerPoint('${tab.id}', ${i})">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
          <input type="checkbox" ${isWatched ? 'checked' : ''} style="accent-color: var(--emerald); pointer-events: none;">
          <div style="min-width: 0;">
            <div style="font-family: monospace; font-size: 10px; color: var(--cyan);">#${plcAddr} (Addr ${addrDec})</div>
            <div style="font-weight: 700; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 135px;" title="${escapeHtmlStr(label)}">${escapeHtmlStr(label)}</div>
          </div>
        </div>
        <span style="font-family: monospace; font-weight: 800; color: #fbbf24; font-size: 11px; flex-shrink: 0;">${valStr} ${escapeHtmlStr(unit)}</span>
      </div>
    `);
  }

  box.innerHTML = itemsHtml.length > 0
    ? itemsHtml.join('')
    : `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 14px;">Không có thanh ghi nào khớp bộ lọc.</div>`;

  const badge = document.getElementById('badgeModalTrendCount');
  if (badge) badge.textContent = `${trendWatches.length} Tag đang chọn`;
}

function toggleTrendPickerPoint(tabId, idx) {
  const tab = sessionTabs.find(t => t.id === tabId);
  if (!tab) return;
  toggleTrendWatchItem(tab, idx);
  renderTrendTagManagerPickerList();
  renderTrendWatchedTableInModal();
}

function batchSelectTaggedInTrendMgr() {
  const tabId = document.getElementById('selTrendMgrTab')?.value || activeTabId;
  const tab = sessionTabs.find(t => t.id === tabId) || getActiveTab();
  if (!tab) return;
  let added = 0;
  for (let i = 0; i < tab.count; i++) {
    if (isRegisterDisabled(tab, i)) continue;
    const rawTag = getPointMeta(tab.tags, i, tab.start_addr, "");
    if (!rawTag || !String(rawTag).trim()) continue;
    const addrDec = tab.start_addr + i;
    if (!isPointWatchedInTrend(tab.id, addrDec)) {
      const item = createWatchItemFromTabPoint(tab, i, trendWatches.length);
      trendWatches.push(item);
      const raw = Array.isArray(tab.values) ? tab.values[i] : undefined;
      if (raw !== undefined && raw !== null) {
        const stamp = (tab.lastUpdatedMap && tab.lastUpdatedMap[i]) || tab.lastUpdated || new Date().toTimeString().split(' ')[0];
        pushWatchSamplePoint(item, tab, i, raw, stamp);
      }
      added++;
    }
  }
  saveUiStateToStorage();
  renderTrendTagManagerPickerList();
  renderTrendWatchedTableInModal();
  renderTrendStudioView();
  showToast(`⚡ Đã thêm ${added} Tag của '${tab.name}' vào danh sách theo dõi!`);
}

function clearAllTrendWatches() {
  trendWatches = [];
  trendWatchesUserCleared = true;
  saveUiStateToStorage();
  renderTrendTagManagerPickerList();
  renderTrendWatchedTableInModal();
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
  showToast("🗑️ Đã xóa sạch các Thẻ Động & Tag theo dõi.");
}

function renderTrendWatchedTableInModal() {
  const tbody = document.getElementById('tblTrendWatchedTags');
  const badge = document.getElementById('badgeModalTrendCount');
  if (badge) badge.textContent = `${trendWatches.length} Tag đang chọn`;
  if (!tbody) return;
  if (trendWatches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 16px;">Chưa chọn Tag nào. Tích vào các ô phía trên để đưa vào Bảng Thẻ Động & Biểu Đồ.</td></tr>`;
    return;
  }

  tbody.innerHTML = trendWatches.map((w, idx) => {
    const snap = getLiveWatchSnapshot(w);
    const pLbl = snap.tab ? shortPortLabel(snap.tab.port) : shortPortLabel(w.port);
    const ctrl = (snap.tab && snap.idx >= 0) ? getEffectiveControlConfig(snap.tab, snap.idx) : { type: 'readonly' };
    return `
      <tr>
        <td>
          <div style="display: flex; gap: 3px;">
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px;" onclick="moveTrendWatchCard(${idx}, -1, event)">▲</button>
            <button class="btn btn-outline" style="padding: 2px 5px; font-size: 10px;" onclick="moveTrendWatchCard(${idx}, 1, event)">▼</button>
          </div>
        </td>
        <td style="text-align: center;">
          <input type="checkbox" ${w.visible !== false ? 'checked' : ''} onchange="toggleTrendWatchVisibility(${idx}, event)" style="accent-color: ${w.color}; cursor: pointer;">
        </td>
        <td style="font-family: monospace; font-size: 11px; color: var(--cyan);">
          ${escapeHtmlStr(pLbl)} • Addr <b>${w.addr}</b>
        </td>
        <td>
          <input type="text" value="${escapeHtmlStr(snap.alias)}" style="width: 100%; font-size: 11px; padding: 3px 6px;"
            onchange="onModalEditWatchField(${idx}, 'alias', this.value)">
        </td>
        <td>
          <input type="text" value="${escapeHtmlStr(snap.unit)}" style="width: 58px; font-size: 11px; padding: 3px 5px;"
            onchange="onModalEditWatchField(${idx}, 'unit', this.value)">
        </td>
        <td>
          <input type="number" step="any" value="${snap.scale}" style="width: 58px; font-size: 11px; padding: 3px 5px;"
            onchange="onModalEditWatchField(${idx}, 'scale', parseFloat(this.value) || 1)">
        </td>
        <td>
          <input type="color" value="${w.color || '#06b6d4'}" style="width: 34px; height: 24px; padding: 0; border: none; background: transparent; cursor: pointer;"
            onchange="onModalEditWatchField(${idx}, 'color', this.value)">
        </td>
        <td>
          <select style="font-size: 11px; padding: 3px 5px;" onchange="onModalEditWatchField(${idx}, 'span', parseInt(this.value))">
            <option value="1" ${w.span !== 2 ? 'selected' : ''}>1x1 Chuẩn</option>
            <option value="2" ${w.span === 2 ? 'selected' : ''}>2x1 Rộng</option>
          </select>
        </td>
        <td>
          <select style="font-size: 11px; padding: 3px 5px;" onchange="onModalEditWatchField(${idx}, 'ctrlType', this.value)">
            <option value="auto" ${ctrl.isAuto ? 'selected' : ''}>Tự động (${ctrl.type})</option>
            <option value="readonly" ${!ctrl.isAuto && ctrl.type === 'readonly' ? 'selected' : ''}>🔒 Chỉ đọc</option>
            <option value="buttons" ${!ctrl.isAuto && ctrl.type === 'buttons' ? 'selected' : ''}>🎛️ Nút Chế Độ</option>
            <option value="toggle" ${!ctrl.isAuto && ctrl.type === 'toggle' ? 'selected' : ''}>🟢 Bật / Tắt DO</option>
            <option value="dropdown" ${!ctrl.isAuto && ctrl.type === 'dropdown' ? 'selected' : ''}>📋 Menu Xổ</option>
            <option value="stepper" ${!ctrl.isAuto && ctrl.type === 'stepper' ? 'selected' : ''}>🔢 Stepper +/-</option>
          </select>
        </td>
        <td>
          <button class="btn btn-outline" style="padding: 2px 6px; font-size: 11px; color: var(--rose);" onclick="removeTrendWatchByIndex(${idx}, event)">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function onModalEditWatchField(index, field, val) {
  const w = trendWatches[index];
  if (!w) return;
  const snap = getLiveWatchSnapshot(w);
  if (field === 'alias') {
    w.alias = String(val || '').trim();
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.tags, snap.idx, snap.tab.start_addr, w.alias);
  } else if (field === 'unit') {
    w.unit = String(val || '').trim();
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.units, snap.idx, snap.tab.start_addr, w.unit);
  } else if (field === 'scale') {
    w.scale = Number(val) || 1.0;
    if (snap.tab && snap.idx >= 0) setPointMeta(snap.tab.scales, snap.idx, snap.tab.start_addr, w.scale);
  } else if (field === 'color') {
    w.color = val;
  } else if (field === 'span') {
    w.span = (Number(val) === 2) ? 2 : 1;
  } else if (field === 'ctrlType' && snap.tab && snap.idx >= 0) {
    if (!snap.tab.controls) snap.tab.controls = {};
    const addrDec = snap.tab.start_addr + snap.idx;
    const roSet = parseAddrRangeSet(snap.tab.read_only_addrs);
    const rwSet = parseAddrRangeSet(snap.tab.writable_addrs);
    if (val === 'readonly' || val === 'none') {
      roSet.add(addrDec);
      rwSet.delete(addrDec);
      setPointMeta(snap.tab.controls, snap.idx, snap.tab.start_addr, { type: 'readonly' });
    } else {
      roSet.delete(addrDec);
      if (val !== 'auto') rwSet.add(addrDec);
      if (val === 'auto') {
        setPointMeta(snap.tab.controls, snap.idx, snap.tab.start_addr, undefined);
      } else if (val === 'toggle') {
        setPointMeta(snap.tab.controls, snap.idx, snap.tab.start_addr, { type: 'toggle', onValue: 1, offValue: 0 });
      } else if (val === 'stepper') {
        setPointMeta(snap.tab.controls, snap.idx, snap.tab.start_addr, { type: 'stepper', step: 1, min: 0, max: 65535 });
      } else if (val === 'dropdown' || val === 'buttons') {
        const curInferred = inferControlFromTagAndFn(w.alias, snap.tab.fn_code);
        setPointMeta(snap.tab.controls, snap.idx, snap.tab.start_addr, {
          type: val,
          options: (curInferred.options && curInferred.options.length > 0)
            ? curInferred.options
            : [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }, { value: 2, label: 'Toggle' }]
        });
      }
    }
    snap.tab.read_only_addrs = Array.from(roSet).sort((a, b) => a - b);
    snap.tab.writable_addrs = Array.from(rwSet).sort((a, b) => a - b);
  }
  saveUiStateToStorage();
  renderTrendTagManagerPickerList();
  renderTrendWatchedTableInModal();
  renderTrendStudioView();
  if (typeof renderTable === 'function') renderTable();
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
let lastServerActiveProfile = "";

async function updateSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status === 'online') {
      const serverProf = (data.active_profile_name || '').trim();
      const serverTabs = Array.isArray(data.saved_polling_tabs) ? data.saved_polling_tabs : [];

      if (!savedTabsHydrated) {
        savedTabsHydrated = true;
        if (serverTabs.length > 0 && (!window.restoredTabsFromLocalStorage || (serverProf && serverProf !== currentProfileName))) {
          currentProfileName = serverProf || currentProfileName;
          if (typeof hydrateTabsFromProfileArray === 'function') {
            hydrateTabsFromProfileArray(serverTabs);
          }
        } else if (window.restoredTabsFromLocalStorage) {
          // Start auto_poll on restored tabs if they were polling before reload
          sessionTabs.forEach((tab, idx) => {
            if (tab.auto_poll && !tab.isPolling) {
              tab.isPolling = true;
              setTimeout(() => {
                if (tab.isPolling) {
                  executePoll(tab);
                  tab.timer = setInterval(() => executePoll(tab), tab.scan_ms);
                }
              }, idx * 50);
            }
          });
          renderTabs();
        }
      } else if (serverProf && lastServerActiveProfile && serverProf !== lastServerActiveProfile && serverTabs.length > 0) {
        // Server profile was switched externally (e.g. via API or another client)
        currentProfileName = serverProf;
        if (typeof hydrateTabsFromProfileArray === 'function') {
          hydrateTabsFromProfileArray(serverTabs);
        }
      }

      if (serverProf) {
        lastServerActiveProfile = serverProf;
        currentProfileName = serverProf;
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
