// ============================================================================
// NXChieu Modbus Studio Pro v3.3 — Quick Profile Creator, SD Profile Studio & AI Docs
// File: router_app/web/js/profile_studio_and_builder.js
// ============================================================================

const AI_JSON_TEMPLATES = [
  {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: "BMS_MultiPort_4Nhanh_Va_Skip_CamDoc",
    port_aliases: {
      "/dev/ttyCH0": "Máy Nén Khí Hitachi HISCREW NEXT II",
      "/dev/ttyCH1": "Bộ Hòa Đồng Bộ Deep Sea DSE8610 MKII",
      "/dev/ttyCH2": "Biến Tần Bơm Nước Lạnh",
      "/dev/ttyCH3": "Cảm Biến Nhiệt Ẩm Phòng Máy"
    },
    polling_tabs: [
      {
        name: "COM 1 • Hitachi NEXT II (Gộp 2..30 Né Ô Cấm)",
        port: "/dev/ttyCH0", baud: 19200, parity: "E", stopbits: 1,
        slave_id: 1, fn_code: 3, start_addr: 2, count: 29,
        disabled_addrs: "3-5, 8-10, 12, 17-18",
        only_tagged: false,
        format: "uint16", scan_ms: 1000, auto_poll: false,
        tags: {
          "0": "Discharge_Pressure_P1_ApSuatKhiXa",
          "4": "Discharge_Temp_T1_NhietDoKhiXa",
          "9": "Intake_Pressure_P0_ApSuatHut",
          "11": "Motor_Current_DongDienMotor",
          "17": "Run_Status_Bits",
          "24": "Total_Running_Hours_GioChay"
        },
        units: { "0": "MPa", "4": "°C", "9": "MPa", "11": "A", "24": "h" },
        scales: { "0": 0.01, "4": 0.1, "9": 0.01, "11": 0.1, "24": 1.0 }
      },
      {
        name: "COM 2 • DSE8610 Điện Áp & Dòng (Né 1058)",
        port: "/dev/ttyCH1", baud: 19200, parity: "N", stopbits: 1,
        slave_id: 1, fn_code: 3, start_addr: 1024, count: 50,
        disabled_addrs: [1058],
        format: "uint16", scan_ms: 1000, auto_poll: false,
        tags: {
          "0": "Oil_Pressure_kPa", "1": "Coolant_Temp_C", "4": "Battery_Voltage_V",
          "8": "Gen_Frequency_Hz", "35": "Bus_Frequency_Hz"
        },
        units: { "0": "kPa", "1": "°C", "4": "V", "8": "Hz", "35": "Hz" },
        scales: { "0": 1.0, "1": 1.0, "4": 0.1, "8": 0.1, "35": 0.1 }
      },
      {
        name: "COM 3 • Biến Tần Bơm",
        port: "/dev/ttyCH2", baud: 9600, parity: "N", stopbits: 1,
        slave_id: 2, fn_code: 3, start_addr: 0, count: 4, format: "uint16", scan_ms: 1000, auto_poll: false,
        tags: { "0": "Tần số đặt", "1": "Tần số chạy thực", "2": "Dòng điện Motor", "3": "Điện áp DC Bus" },
        units: { "0": "Hz", "1": "Hz", "2": "A", "3": "V" },
        scales: { "0": 0.01, "1": 0.01, "2": 0.1, "3": 1.0 }
      },
      {
        name: "COM 4 • Nhiệt Ẩm Phòng",
        port: "/dev/ttyCH3", baud: 9600, parity: "N", stopbits: 1,
        slave_id: 1, fn_code: 4, start_addr: 0, count: 2, format: "int16", scan_ms: 2000, auto_poll: false,
        tags: { "0": "Nhiệt độ phòng máy", "1": "Độ ẩm tương đối" },
        units: { "0": "°C", "1": "%RH" },
        scales: { "0": 0.1, "1": 0.1 }
      }
    ]
  },
  {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: "AI_Datalogger_Da_Cong_24h",
    port_aliases: { "/dev/ttyCH0": "Nhánh Đồng Hồ", "/dev/ttyCH1": "Nhánh Chiller" },
    datalogger: {
      auto_start: false,
      name: "Ghi_Ngam_Da_Cong_24h",
      interval_sec: 2,
      batch_size: 30,
      channels: [
        {
          label: "COM1_MSB", port: "/dev/ttyCH0", baud: 9600, parity: "N", stopbits: 1,
          slave_id: 1, fn_code: 3, start_addr: 0, count: 6, disabled_addrs: "3-4",
          tags: { "0": "Ua_V", "1": "Ia_A", "2": "P_kW", "5": "Freq_Hz" },
          scales: { "0": 0.1, "1": 0.01, "2": 0.1, "5": 0.01 },
          units: { "0": "V", "1": "A", "2": "kW", "5": "Hz" }
        },
        {
          label: "COM2_Chiller", port: "/dev/ttyCH1", baud: 19200, parity: "E", stopbits: 1,
          slave_id: 1, fn_code: 3, start_addr: 0, count: 3,
          tags: { "0": "CHWS_C", "1": "CHWR_C", "2": "Load_Pct" },
          scales: { "0": 0.1, "1": 0.1, "2": 1.0 },
          units: { "0": "C", "1": "C", "2": "%" }
        }
      ]
    }
  },
  {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: "Gateway_8_Cong_TCP_5001_5008",
    gateways: {
      auto_start_on_apply: true,
      auto_start_on_boot: true,
      ports: Array.from({ length: 8 }, (_, i) => ({
        port: `/dev/ttyCH${i}`, tcp_port: 5001 + i, baud: 9600, parity: "N", stopbits: 1
      }))
    }
  }
];

// ============================================================================
// QUICK PROFILE BUILDER & FAST FIELD TESTER (#quickProfileBuilderModal)
// ============================================================================
let quickBuilderTabs = [];

function parseQuickTagsSpec(specStr, startAddr) {
  const tags = {};
  const units = {};
  const scales = {};
  if (!specStr || !String(specStr).trim()) return { tags, units, scales };
  const sAddr = parseInt(startAddr) || 0;
  const parts = String(specStr).split(/[,;\n]+/);
  parts.forEach(rawPart => {
    const p = rawPart.trim();
    if (!p) return;
    const eqIdx = p.indexOf('=');
    if (eqIdx <= 0) return;
    let keyStr = p.slice(0, eqIdx).trim();
    const rest = p.slice(eqIdx + 1).trim();
    if (!rest) return;

    let offsetKey = "0";
    if (keyStr.startsWith('@')) {
      const absA = parseInt(keyStr.slice(1));
      if (!isNaN(absA)) offsetKey = String(Math.max(0, absA - sAddr));
    } else {
      const numK = parseInt(keyStr);
      if (!isNaN(numK)) {
        // Nếu người dùng nhập địa chỉ tuyệt đối >= startAddr (khi startAddr > 0 và không có key 0)
        offsetKey = String(numK);
      }
    }

    const segs = rest.split(':').map(x => x.trim());
    if (segs[0]) tags[offsetKey] = segs[0];
    if (segs[1]) units[offsetKey] = segs[1];
    if (segs[2] !== undefined && segs[2] !== '') {
      const sc = parseFloat(segs[2]);
      if (!isNaN(sc)) scales[offsetKey] = sc;
    }
  });
  return { tags, units, scales };
}

function formatQuickTagsSpec(tags, units, scales, startAddr) {
  if (!tags || typeof tags !== 'object') return "";
  const items = [];
  const sAddr = parseInt(startAddr) || 0;
  Object.keys(tags).forEach(k => {
    const name = tags[k];
    if (!name || !String(name).trim()) return;
    const u = (units && units[k]) ? units[k] : '';
    const sc = (scales && scales[k] !== undefined && scales[k] !== 1 && scales[k] !== 1.0) ? scales[k] : '';
    if (sc !== '') {
      items.push(`${k}=${name}:${u}:${sc}`);
    } else if (u !== '') {
      items.push(`${k}=${name}:${u}`);
    } else {
      items.push(`${k}=${name}`);
    }
  });
  return items.join(', ');
}

function openQuickProfileBuilderModal(presetKey) {
  const modal = document.getElementById('quickProfileBuilderModal');
  if (!modal) return;
  if (presetKey) {
    applyQuickBuilderPreset(presetKey);
  } else if (quickBuilderTabs.length === 0) {
    applyQuickBuilderPreset('custom1');
  } else {
    renderQuickBuilderTabsList();
  }
  modal.classList.add('open');
}

function closeQuickProfileBuilderModal() {
  const modal = document.getElementById('quickProfileBuilderModal');
  if (modal) modal.classList.remove('open');
}

function applyQuickBuilderPreset(presetKey) {
  const nameInp = document.getElementById('inpQbProfileName');
  const defPort = (availablePortsCache && availablePortsCache[0]) ? availablePortsCache[0].id : (globalSerial.port || "/dev/ttyCH0");

  if (presetKey === 'custom1') {
    if (nameInp) nameInp.value = `Test_Nhanh_${shortPortLabel(defPort).replace(/\s+/g, '')}`;
    quickBuilderTabs = [
      {
        name: `${shortPortLabel(defPort)} • Test Nhanh`,
        port: defPort,
        baud: globalSerial.baud || 9600,
        framing: `${globalSerial.parity || 'N'}-${globalSerial.stopbits || 1}`,
        slave_id: 1,
        fn_code: 3,
        start_addr: 0,
        count: 10,
        disabled_addrs: "",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Điện áp U:V:0.1, 1=Dòng điện I:A:0.01, 2=Công suất P:kW:0.1, 3=Tần số F:Hz:0.01"
      }
    ];
  } else if (presetKey === 'all8com') {
    if (nameInp) nameInp.value = "Khao_Sat_Dong_Loat_8_Cong_COM";
    quickBuilderTabs = Array.from({ length: 8 }, (_, i) => ({
      name: `COM ${i + 1} • Nhánh #${i + 1}`,
      port: `/dev/ttyCH${i}`,
      baud: 9600,
      framing: "N-1",
      slave_id: 1,
      fn_code: 3,
      start_addr: 0,
      count: 10,
      disabled_addrs: "",
      format: "uint16",
      scan_ms: 1000,
      tags_spec: "0=Kênh #0, 1=Kênh #1, 2=Kênh #2"
    }));
  } else if (presetKey === 'hitachi') {
    if (nameInp) nameInp.value = "Hitachi_HISCREW_NEXT_II_NeOCam";
    quickBuilderTabs = [
      {
        name: "COM 1 • Hitachi NEXT II (Né Ô Cấm Giữa)",
        port: "/dev/ttyCH0",
        baud: 19200,
        framing: "E-1",
        slave_id: 1,
        fn_code: 3,
        start_addr: 2,
        count: 29,
        disabled_addrs: "3-5, 8-10, 12, 17-18",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Áp suất khí xả P1:MPa:0.01, 4=Nhiệt độ đầu nén T1:°C:0.1, 9=Áp suất hút P0:MPa:0.01, 11=Dòng điện Motor:A:0.1, 17=Trạng thái chạy::1, 24=Tổng giờ chạy:h:1"
      }
    ];
  } else if (presetKey === 'dse8610') {
    if (nameInp) nameInp.value = "DeepSea_DSE8610_MKII_GenSet";
    quickBuilderTabs = [
      {
        name: "COM 2 • DSE8610 MKII (Basic Instrumentation)",
        port: "/dev/ttyCH1",
        baud: 19200,
        framing: "N-1",
        slave_id: 1,
        fn_code: 3,
        start_addr: 1024,
        count: 42,
        disabled_addrs: "1058",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Áp suất nhớt:kPa:1, 1=Nhiệt độ nước:°C:1, 4=Điện áp ắc quy:V:0.1, 7=Tốc độ động cơ:RPM:1, 8=Tần số máy phát:Hz:0.1, 35=Tần số lưới/Bus:Hz:0.1"
      }
    ];
  } else if (presetKey === 'meter') {
    if (nameInp) nameInp.value = "Dong_Ho_Dien_3Pha_Modbus";
    quickBuilderTabs = [
      {
        name: "COM 1 • Đồng Hồ Điện 3 Pha",
        port: defPort,
        baud: 9600,
        framing: "N-1",
        slave_id: 1,
        fn_code: 3,
        start_addr: 0,
        count: 16,
        disabled_addrs: "",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Điện áp Pha A:V:0.1, 1=Điện áp Pha B:V:0.1, 2=Điện áp Pha C:V:0.1, 3=Dòng điện Pha A:A:0.01, 4=Dòng điện Pha B:A:0.01, 5=Dòng điện Pha C:A:0.01, 6=Công suất tổng P:kW:0.1, 7=Hệ số CosPhi::0.001, 8=Tần số lưới:Hz:0.01"
      }
    ];
  } else if (presetKey === 'inverter') {
    if (nameInp) nameInp.value = "Bien_Tan_VFD_Test_Nhanh";
    quickBuilderTabs = [
      {
        name: "COM 1 • Biến Tần VFD",
        port: defPort,
        baud: 9600,
        framing: "N-1",
        slave_id: 1,
        fn_code: 3,
        start_addr: 0,
        count: 10,
        disabled_addrs: "",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Từ điều khiển Run/Stop::1, 1=Tần số đặt:Hz:0.01, 2=Tần số chạy thực tế:Hz:0.01, 3=Dòng điện Motor:A:0.1, 4=Điện áp ngõ ra:V:0.1, 5=Điện áp DC Bus:V:0.1, 6=Mã lỗi biến tần::1"
      }
    ];
  } else if (presetKey === 'modbus_tcp') {
    if (nameInp) nameInp.value = "Modbus_TCP_PLC_Gateway_Test";
    quickBuilderTabs = [
      {
        name: "TCP 192.168.10.1:502 • PLC / Gateway",
        port: "tcp://192.168.10.1:502",
        baud: 9600,
        framing: "N-1",
        slave_id: 1,
        fn_code: 3,
        start_addr: 0,
        count: 10,
        disabled_addrs: "",
        format: "uint16",
        scan_ms: 1000,
        tags_spec: "0=Thanh ghi TCP #0, 1=Thanh ghi TCP #1, 2=Thanh ghi TCP #2"
      }
    ];
  }

  renderQuickBuilderTabsList();
}

function loadCurrentWorkspaceIntoQuickBuilder() {
  const nameInp = document.getElementById('inpQbProfileName');
  if (nameInp) nameInp.value = currentProfileName || "Ho_So_Tuy_Chinh";
  quickBuilderTabs = sessionTabs.map(t => ({
    name: t.name,
    port: t.port,
    baud: t.baud || 9600,
    framing: `${t.parity || 'N'}-${t.stopbits || 1}`,
    slave_id: t.slave_id || 1,
    fn_code: t.fn_code || 3,
    start_addr: t.start_addr || 0,
    count: t.count || 10,
    disabled_addrs: formatAddrRangeString(parseAddrRangeSet(t.disabled_addrs)),
    format: t.format || "uint16",
    scan_ms: t.scan_ms || 1000,
    tags_spec: formatQuickTagsSpec(t.tags, t.units, t.scales, t.start_addr)
  }));
  renderQuickBuilderTabsList();
  showToast(`Đã nạp ${quickBuilderTabs.length} Tab đang mở vào Trình Tạo Hồ Sơ Nhanh!`);
}

function addQuickBuilderTabRow() {
  const nextIdx = quickBuilderTabs.length + 1;
  const portCandidate = `/dev/ttyCH${(nextIdx - 1) % 8}`;
  quickBuilderTabs.push({
    name: `COM ${((nextIdx - 1) % 8) + 1} • Thiết Bị #${nextIdx}`,
    port: portCandidate,
    baud: 9600,
    framing: "N-1",
    slave_id: 1,
    fn_code: 3,
    start_addr: 0,
    count: 10,
    disabled_addrs: "",
    format: "uint16",
    scan_ms: 1000,
    tags_spec: ""
  });
  renderQuickBuilderTabsList();
}

function duplicateQuickBuilderTabRow(idx) {
  const src = quickBuilderTabs[idx];
  if (!src) return;
  const copy = {
    ...src,
    name: `${src.name} (Bản sao)`
  };
  quickBuilderTabs.splice(idx + 1, 0, copy);
  renderQuickBuilderTabsList();
}

function removeQuickBuilderTabRow(idx) {
  if (quickBuilderTabs.length <= 1) {
    alert("Hồ sơ cần có ít nhất 1 Tab thiết bị!");
    return;
  }
  quickBuilderTabs.splice(idx, 1);
  renderQuickBuilderTabsList();
}

function updateQuickBuilderField(idx, field, val) {
  if (!quickBuilderTabs[idx]) return;
  quickBuilderTabs[idx][field] = val;
  const previewEl = document.getElementById(`qbSubBlockPreview_${idx}`);
  if (previewEl) {
    const row = quickBuilderTabs[idx];
    const parsedMeta = parseQuickTagsSpec(row.tags_spec, row.start_addr);
    const fakeTab = {
      start_addr: parseInt(row.start_addr) || 0,
      count: Math.max(1, Math.min(250, parseInt(row.count) || 10)),
      disabled_addrs: Array.from(parseAddrRangeSet(row.disabled_addrs)),
      only_tagged: false,
      tags: parsedMeta.tags
    };
    const subInfo = computeClientSubBlocks(fakeTab);
    previewEl.innerHTML = subInfo.skippedTotal > 0
      ? `📦 Tự tách thành <b style="color:var(--emerald);">${subInfo.blocks.length} khối lệnh RTU</b> • Đọc <b>${subInfo.enabledTotal}/${fakeTab.count}</b> ô • Né <b style="color:var(--amber);">${subInfo.skippedTotal} ô cấm</b>`
      : `📦 Đọc liền mạch <b style="color:var(--cyan);">${subInfo.blocks.length} khối lệnh</b> (${fakeTab.count} thanh ghi từ ${fakeTab.start_addr}..${fakeTab.start_addr + fakeTab.count - 1})`;
  }
}

function renderQuickBuilderTabsList() {
  const container = document.getElementById('qbTabsListContainer');
  if (!container) return;
  const badgeCnt = document.getElementById('badgeQbTabCount');
  if (badgeCnt) badgeCnt.textContent = `${quickBuilderTabs.length} Tab Thiết Bị`;

  const portOpts = (selPort) => {
    const list = (availablePortsCache && availablePortsCache.length > 0)
      ? availablePortsCache
      : Array.from({ length: 8 }, (_, i) => ({ id: `/dev/ttyCH${i}`, label: `COM ${i + 1} (/dev/ttyCH${i})` }));
    const tcpPresets = [
      { id: 'tcp://192.168.10.1:502', label: '🌐 [Modbus TCP] 192.168.10.1:502 (MBAP)' },
      { id: 'tcp://127.0.0.1:5000', label: '🌐 [Modbus TCP] 127.0.0.1:5000 (Smart Hub)' },
      { id: 'tcp://127.0.0.1:5001', label: '🌐 [Modbus TCP] 127.0.0.1:5001 (GW COM 1)' },
      { id: 'rtuovertcp://192.168.10.1:502', label: '🌐 [RTU over TCP] 192.168.10.1:502 (CRC16)' }
    ];
    if (selPort && /^(tcp|rtuovertcp|rtu_tcp):\/\//i.test(selPort) && !tcpPresets.some(x => x.id === selPort)) {
      tcpPresets.unshift({ id: selPort, label: `🌐 [TCP Tùy Chỉnh] ${selPort}` });
    }
    return list.map(p => `<option value="${p.id}" ${p.id === selPort ? 'selected' : ''}>${p.label}</option>`).join('') +
      `<optgroup label="🌐 Kết Nối Modbus TCP / RTU-over-TCP">` +
      tcpPresets.map(p => `<option value="${p.id}" ${p.id === selPort ? 'selected' : ''}>${p.label}</option>`).join('') +
      `</optgroup>`;
  };

  const baudOpts = (selBaud) => STANDARD_BAUDS.map(b =>
    `<option value="${b}" ${Number(b) === Number(selBaud) ? 'selected' : ''}>${b} bps</option>`
  ).join('');

  container.innerHTML = quickBuilderTabs.map((row, idx) => {
    const sAddr = parseInt(row.start_addr) || 0;
    const cnt = Math.max(1, Math.min(250, parseInt(row.count) || 10));
    const fakeTab = {
      start_addr: sAddr,
      count: cnt,
      disabled_addrs: Array.from(parseAddrRangeSet(row.disabled_addrs)),
      only_tagged: false,
      tags: {}
    };
    const subInfo = computeClientSubBlocks(fakeTab);
    const subSummary = subInfo.skippedTotal > 0
      ? `📦 Tự tách thành <b style="color:var(--emerald);">${subInfo.blocks.length} khối lệnh RTU</b> • Đọc <b>${subInfo.enabledTotal}/${cnt}</b> ô • Né <b style="color:var(--amber);">${subInfo.skippedTotal} ô cấm</b>`
      : `📦 Đọc liền mạch <b style="color:var(--cyan);">${subInfo.blocks.length} khối lệnh</b> (${cnt} thanh ghi từ ${sAddr}..${sAddr + cnt - 1})`;

    return `
      <div class="qb-tab-card">
        <div class="qb-tab-card-header">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="badge badge-cyan" style="font-size: 11px;">TAB #${idx + 1}</span>
            <span id="qbSubBlockPreview_${idx}" style="font-size: 11px; color: var(--text-muted);">${subSummary}</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px;" onclick="duplicateQuickBuilderTabRow(${idx})" title="Nhân bản Tab này">📋 Nhân Bản</button>
            ${quickBuilderTabs.length > 1 ? `<button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; color: var(--rose);" onclick="removeQuickBuilderTabRow(${idx})" title="Xóa Tab này">🗑️ Xóa</button>` : ''}
          </div>
        </div>

        <div class="qb-grid-row">
          <div class="field-box">
            <label>Tên Tab / Thiết Bị</label>
            <input type="text" value="${(row.name || '').replace(/"/g, '&quot;')}" placeholder="VD: COM 1 • Máy Nén Khí"
                   oninput="updateQuickBuilderField(${idx}, 'name', this.value)">
          </div>
          <div class="field-box">
            <label>Cổng Vật Lý RS485</label>
            <select onchange="updateQuickBuilderField(${idx}, 'port', this.value)">
              ${portOpts(row.port)}
            </select>
          </div>
          <div class="field-box">
            <label>Tốc Độ Baud</label>
            <select onchange="updateQuickBuilderField(${idx}, 'baud', parseInt(this.value) || 9600)">
              ${baudOpts(row.baud)}
            </select>
          </div>
          <div class="field-box">
            <label>Khung Truyền</label>
            <select onchange="updateQuickBuilderField(${idx}, 'framing', this.value)">
              <option value="N-1" ${row.framing === 'N-1' ? 'selected' : ''}>8N1 (Chuẩn)</option>
              <option value="E-1" ${row.framing === 'E-1' ? 'selected' : ''}>8E1 (Chẵn)</option>
              <option value="O-1" ${row.framing === 'O-1' ? 'selected' : ''}>8O1 (Lẻ)</option>
              <option value="N-2" ${row.framing === 'N-2' ? 'selected' : ''}>8N2 (2 Stop)</option>
            </select>
          </div>
          <div class="field-box">
            <label>Slave ID</label>
            <input type="number" min="1" max="247" value="${row.slave_id}"
                   oninput="updateQuickBuilderField(${idx}, 'slave_id', parseInt(this.value) || 1)">
          </div>
          <div class="field-box">
            <label>Hàm Modbus (FC)</label>
            <select onchange="updateQuickBuilderField(${idx}, 'fn_code', parseInt(this.value) || 3)">
              <option value="3" ${Number(row.fn_code) === 3 ? 'selected' : ''}>FC03 Holding (4x)</option>
              <option value="4" ${Number(row.fn_code) === 4 ? 'selected' : ''}>FC04 Input (3x)</option>
              <option value="1" ${Number(row.fn_code) === 1 ? 'selected' : ''}>FC01 Coils (0x)</option>
              <option value="2" ${Number(row.fn_code) === 2 ? 'selected' : ''}>FC02 Discrete (1x)</option>
            </select>
          </div>
          <div class="field-box">
            <label>Địa Chỉ Đầu (0-based)</label>
            <input type="number" min="0" max="65535" value="${row.start_addr}"
                   oninput="updateQuickBuilderField(${idx}, 'start_addr', parseInt(this.value) || 0)">
          </div>
          <div class="field-box">
            <label>Số Lượng (1..250)</label>
            <input type="number" min="1" max="250" value="${row.count}"
                   oninput="updateQuickBuilderField(${idx}, 'count', Math.max(1, Math.min(250, parseInt(this.value) || 10)))">
          </div>
        </div>

        <div class="qb-bottom-meta-grid">
          <div class="field-box">
            <label style="color: var(--amber);">🚫 Địa Chỉ Cấm Đọc Ở Giữa (Tự động tách khối né Exception 0x02)</label>
            <input type="text" value="${(row.disabled_addrs || '').replace(/"/g, '&quot;')}" placeholder="VD: 3-5, 8-10, 12 (Để trống nếu đọc hết)"
                   style="font-family: monospace; border-color: rgba(245,158,11,0.35); color: #fde68a;"
                   oninput="updateQuickBuilderField(${idx}, 'disabled_addrs', this.value)">
          </div>
          <div class="field-box">
            <label style="color: var(--emerald);">🏷️ Khai Nhanh Tên Tag : Đơn Vị : Hệ Số (Cách nhau dấu phẩy, tùy chọn)</label>
            <input type="text" value="${(row.tags_spec || '').replace(/"/g, '&quot;')}" placeholder="VD: 0=Áp suất P1:MPa:0.01, 4=Nhiệt độ T1:°C:0.1, 11=Dòng Motor:A:0.1"
                   style="font-family: monospace; border-color: rgba(16,185,129,0.35);"
                   oninput="updateQuickBuilderField(${idx}, 'tags_spec', this.value)">
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function buildQuickBuilderProfileObject() {
  const rawName = (document.getElementById('inpQbProfileName')?.value || '').trim() || `Ho_So_Nhanh_${new Date().toISOString().slice(11,19).replace(/:/g,'')}`;
  const autoPoll = Boolean(document.getElementById('chkQbAutoStartPoll')?.checked);

  const tabs = quickBuilderTabs.map((r, idx) => {
    const fp = (r.framing || 'N-1').split('-');
    const parity = (fp[0] || 'N').toUpperCase();
    const stopbits = parseInt(fp[1]) || 1;
    const sAddr = parseInt(r.start_addr) || 0;
    const cnt = Math.max(1, Math.min(250, parseInt(r.count) || 10));
    const disArr = Array.from(parseAddrRangeSet(r.disabled_addrs)).sort((a, b) => a - b);
    const meta = parseQuickTagsSpec(r.tags_spec, sAddr);

    return {
      id: `tab_qb_${idx + 1}`,
      name: (r.name || '').trim() || `Kênh ${idx + 1}`,
      port: r.port || "/dev/ttyCH0",
      baud: parseInt(r.baud) || 9600,
      parity: parity,
      stopbits: stopbits,
      slave_id: parseInt(r.slave_id) || 1,
      fn_code: parseInt(r.fn_code) || 3,
      start_addr: sAddr,
      count: cnt,
      disabled_addrs: disArr,
      only_tagged: false,
      format: r.format || "uint16",
      scan_ms: parseInt(r.scan_ms) || 1000,
      auto_poll: autoPoll,
      tags: meta.tags,
      units: meta.units,
      scales: meta.scales
    };
  });

  const aliases = { ...portAliasesCache };
  tabs.forEach(t => {
    if (t.port && t.name) aliases[t.port] = t.name;
  });

  return {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: rawName,
    created_at: new Date().toISOString(),
    port_aliases: aliases,
    polling_tabs: tabs
  };
}

async function submitQuickProfileBuilder(mode) {
  const profObj = buildQuickBuilderProfileObject();
  if (mode === 'run_temp') {
    currentProfileName = profObj.profile_name;
    hydrateTabsFromProfileArray(profObj.polling_tabs);
    closeQuickProfileBuilderModal();
    showView('poll');
    showToast(`⚡ Đã mở phiên Test Nhanh '${profObj.profile_name}' (${profObj.polling_tabs.length} Tab)!`);
    return;
  }

  if (mode === 'save_and_inspect') {
    try {
      const res = await fetch('/api/profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: profObj.profile_name,
          profile: profObj
        })
      });
      const data = await res.json();
      if (data.success) {
        const savedFn = (data.imported_items && data.imported_items[0]) ? data.imported_items[0].filename : '';
        if (savedFn) sdStudioSelectedFilename = savedFn;
        if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, savedFn);
        closeQuickProfileBuilderModal();
        showView('profiles');
        await loadSdProfileStudio(true);
        showToast(`💾 Đã tạo & lưu hồ sơ '${profObj.profile_name}' vào Thẻ nhớ SD!`);
      } else {
        alert("Lỗi lưu hồ sơ: " + (data.error || "Thất bại"));
      }
    } catch (e) {
      alert("Lỗi kết nối: " + e);
    }
    return;
  }

  // Default: 'save_and_run'
  closeQuickProfileBuilderModal();
  await applyProfileJsonObject(profObj);
}

// ============================================================================
// AI JSON TEMPLATES & PROFILE HYDRATION
// ============================================================================
function renderAiTemplatePreview(idx) {
  const pre = document.getElementById('preAiTemplatePreview');
  if (pre && AI_JSON_TEMPLATES[idx]) {
    pre.textContent = JSON.stringify(AI_JSON_TEMPLATES[idx], null, 2);
  }
}

function loadSampleJsonToEditor(idx) {
  const tpl = AI_JSON_TEMPLATES[idx] || AI_JSON_TEMPLATES[0];
  const txt = JSON.stringify(tpl, null, 2);
  const area = document.getElementById('txtPasteProfileJson');
  if (area) area.value = txt;
  renderAiTemplatePreview(idx);
  showToast(`Đã nạp Mẫu #${idx + 1} vào ô soạn thảo JSON!`);
}

function copyAiPromptTemplate() {
  const pre = document.getElementById('preAiPromptText');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    showToast("Đã sao chép Prompt chuẩn vào Clipboard! Bạn có thể dán gửi cho bất kỳ AI nào.");
  });
}

function downloadEditorJson() {
  const area = document.getElementById('txtPasteProfileJson');
  const content = (area && area.value.trim()) ? area.value.trim() : JSON.stringify(AI_JSON_TEMPLATES[0], null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nxmodbus_monitor_profile.json';
  a.click();
}

function hydrateTabsFromProfileArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  sessionTabs.forEach(t => { if (t.timer) clearInterval(t.timer); });
  sessionTabs = arr.map((t, idx) => ({
    id: t.id || `tab_prof_${idx + 1}`,
    name: t.name || `Kênh ${idx + 1}`,
    port: t.port || globalSerial.port,
    baud: parseInt(t.baud) || 9600,
    parity: (t.parity || "N").toUpperCase(),
    stopbits: parseInt(t.stopbits) || 1,
    slave_id: parseInt(t.slave_id) || 1,
    fn_code: parseInt(t.fn_code) || 3,
    start_addr: parseInt(t.start_addr) || 0,
    count: Math.max(1, Math.min(250, parseInt(t.count) || 10)),
    disabled_addrs: Array.from(parseAddrRangeSet(t.disabled_addrs)).sort((a, b) => a - b),
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
    selectedIndex: 0,
    auto_poll: Boolean(t.auto_poll)
  }));
  activeTabId = sessionTabs[0].id;
  if (typeof syncTrendWatchesWithSessionTabs === 'function') {
    syncTrendWatchesWithSessionTabs();
  }
  renderTabs();
  sessionTabs.forEach((tab, idx) => {
    if (tab.auto_poll) {
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
  if (typeof saveUiStateToStorage === 'function') saveUiStateToStorage();
}

function buildCurrentProfileExportObject(customName) {
  const pName = (customName && String(customName).trim()) ? String(customName).trim() : (currentProfileName || "NXChieu_MultiPort_Profile");
  return {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: pName,
    exported_at: new Date().toISOString(),
    port_aliases: portAliasesCache,
    polling_tabs: sessionTabs.map(t => ({
      name: t.name,
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
      format: t.format || "uint16",
      scan_ms: t.scan_ms || 1000,
      auto_poll: Boolean(t.isPolling),
      tags: t.tags || {},
      units: t.units || {},
      scales: t.scales || {},
      controls: t.controls || {}
    })),
    trend_watches: typeof trendWatches !== 'undefined' ? trendWatches : [],
    datalogger: {
      auto_start: false,
      name: document.getElementById('inpLogName') ? document.getElementById('inpLogName').value : "Log_Da_Cong",
      interval_sec: document.getElementById('selLogInterval') ? parseInt(document.getElementById('selLogInterval').value) : 2,
      batch_size: document.getElementById('selLogBatch') ? parseInt(document.getElementById('selLogBatch').value) : 30,
      channels: datalogChannelsList
    },
    gateways: {
      auto_start_on_apply: false,
      auto_start_on_boot: document.getElementById('chkGwAutoBoot') ? document.getElementById('chkGwAutoBoot').checked : false,
      ports: multiGwConfigs.map(c => {
        const fp = (c.framing || 'N-1').split('-');
        return { port: c.port, tcp_port: c.tcp_port, baud: c.baud, parity: fp[0] || 'N', stopbits: parseInt(fp[1]) || 1 };
      })
    }
  };
}

async function applyProfileJsonObject(obj) {
  try {
    if (obj.profile_name) {
      currentProfileName = obj.profile_name;
      const inpName = document.getElementById('inpSdProfileSaveName');
      if (inpName) inpName.value = currentProfileName;
    }
    const res = await fetch('/api/profile/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
    const data = await res.json();
    if (!data.success) {
      alert("Lỗi nạp JSON Profile: " + (data.error || "Không hợp lệ"));
      return;
    }
    if (data.port_aliases) portAliasesCache = data.port_aliases;
    if (data.available_ports) {
      availablePortsCache = data.available_ports;
      refreshPortDropdowns();
    }
    const profs = data.saved_profiles || data.sd_profiles || data.profiles;
    if (profs) {
      syncSdProfilesDropdown(profs, data.saved_sd_file || data.saved_file);
    }
    if (typeof initMultiGatewayMatrix === 'function') initMultiGatewayMatrix();

    if (Array.isArray(data.polling_tabs) && data.polling_tabs.length > 0) {
      if (Array.isArray(obj.trend_watches) && obj.trend_watches.length > 0 && typeof trendWatches !== 'undefined') {
        trendWatches = obj.trend_watches;
      } else if (typeof trendWatches !== 'undefined') {
        trendWatches = [];
      }
      hydrateTabsFromProfileArray(data.polling_tabs);
    }
    if (obj.datalogger && Array.isArray(obj.datalogger.channels)) {
      datalogChannelsList = obj.datalogger.channels;
      if (typeof renderDatalogChannelsTable === 'function') renderDatalogChannelsTable();
    }
    showToast(data.message || "Đã nạp cấu hình JSON và lưu bền vững vào Thẻ nhớ SD!");
    if (Array.isArray(data.polling_tabs) && data.polling_tabs.length > 0) {
      showView('poll');
    }
  } catch (e) {
    alert("Lỗi khi áp dụng JSON: " + e);
  }
}

async function applyPastedProfileJson() {
  const area = document.getElementById('txtPasteProfileJson');
  if (!area || !area.value.trim()) {
    alert("Vui lòng dán nội dung JSON vào ô trước khi nhấn Áp dụng!");
    return;
  }
  try {
    const parsed = JSON.parse(area.value.trim());
    await applyProfileJsonObject(parsed);
  } catch (e) {
    alert("Cú pháp JSON không hợp lệ:\n" + e);
  }
}

function handleImportJsonFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.profile_name) {
        parsed.profile_name = file.name.replace(/\.(json|nxmodbus)$/i, '');
      }
      const area = document.getElementById('txtPasteProfileJson');
      if (area) area.value = JSON.stringify(parsed, null, 2);
      await applyProfileJsonObject(parsed);
      const sdModal = document.getElementById('sdProfileModal');
      if (sdModal && sdModal.classList.contains('open')) {
        await refreshSdProfilesList();
      }
    } catch (err) {
      alert("File JSON không đúng định dạng:\n" + err);
    }
  };
  reader.readAsText(file, 'utf-8');
  ev.target.value = '';
}

function exportMonitoringProfileJson() {
  const exportObj = buildCurrentProfileExportObject(currentProfileName);
  const jsonStr = JSON.stringify(exportObj, null, 2);
  const area = document.getElementById('txtPasteProfileJson');
  if (area) area.value = jsonStr;
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentProfileName || 'nxmodbus_profile'}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast("Đã xuất cấu hình theo dõi ra file .JSON!");
}

// ============================================================================
// SD CARD PERSISTENT PROFILE MANAGER & SCIENTIFIC STUDIO (#view-profiles)
// ============================================================================
let sdStudioSelectedFilename = "";
let sdStudioCurrentDetail = null;
let sdStudioActiveTabIdx = 0;

function syncSdProfilesDropdown(list, activeFile) {
  sdProfilesCache = Array.isArray(list) ? list : [];
  const sel = document.getElementById('selQuickSdProfile');
  if (sel) {
    const curVal = activeFile || sel.value || '';
    let html = `<option value="">💳 Hồ Sơ Thẻ SD (${sdProfilesCache.length} bản lưu)...</option>`;
    sdProfilesCache.forEach(p => {
      const fn = p.filename || p.file;
      const skipInfo = p.disabled_total ? ` • Né ${p.disabled_total} ô` : '';
      html += `<option value="${fn}" ${(fn === curVal || p.is_active) ? 'selected' : ''}>📂 ${p.profile_name} (${p.tabs_count} Tab${skipInfo})</option>`;
    });
    sel.innerHTML = html;
  }
  const cntBadge = document.getElementById('sdStudioCountBadge');
  if (cntBadge) cntBadge.textContent = `${sdProfilesCache.length} Hồ Sơ Lưu Trữ`;
  renderSdProfilesModalTable();
  renderSdStudioProfileCards();
}

async function loadSdProfileStudio(forceReloadSelected = false) {
  try {
    const res = await fetch('/api/profile/list');
    const data = await res.json();
    if (data.success) {
      if (data.profiles_dir) {
        const pBadge = document.getElementById('sdStudioPathBadge');
        if (pBadge) pBadge.textContent = data.profiles_dir;
      }
      syncSdProfilesDropdown(data.profiles || []);
      if (sdProfilesCache.length > 0) {
        const exists = sdProfilesCache.some(p => (p.filename || p.file) === sdStudioSelectedFilename);
        if (!sdStudioSelectedFilename || !exists) {
          const activeProf = sdProfilesCache.find(p => p.is_active) || sdProfilesCache[0];
          sdStudioSelectedFilename = activeProf.filename || activeProf.file;
          forceReloadSelected = true;
        }
        if (forceReloadSelected || !sdStudioCurrentDetail) {
          await inspectSdProfileFile(sdStudioSelectedFilename, 0);
        } else {
          renderSdStudioProfileCards();
        }
      }
    }
  } catch (e) {}
}

let sdProfileExpandedCards = new Set();
let sdProfileHasUnsavedChanges = false;

function setSdProfileUnsavedState(unsaved) {
  sdProfileHasUnsavedChanges = Boolean(unsaved);
  const badge = document.getElementById('badgeSdUnsaved');
  if (badge) badge.style.display = sdProfileHasUnsavedChanges ? 'inline-flex' : 'none';
}

function toggleSdProfileCardDetail(fn, ev) {
  if (ev) ev.stopPropagation();
  if (sdProfileExpandedCards.has(fn)) {
    sdProfileExpandedCards.delete(fn);
  } else {
    sdProfileExpandedCards.add(fn);
  }
  renderSdStudioProfileCards();
}

async function editSdProfileCard(fn, ev) {
  if (ev) ev.stopPropagation();
  await inspectSdProfileFile(fn, 0);
  const detailCard = document.getElementById('sdStudioDetailCard');
  if (detailCard && window.innerWidth <= 1180) {
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderSdStudioProfileCards() {
  const box = document.getElementById('sdStudioProfileList');
  if (!box) return;
  const q = (document.getElementById('inpSdStudioSearch')?.value || '').trim().toLowerCase();
  const filtered = (sdProfilesCache || []).filter(p => {
    if (!q) return true;
    const fn = (p.filename || p.file || '').toLowerCase();
    const pn = (p.profile_name || '').toLowerCase();
    const ps = (p.ports_summary || '').toLowerCase();
    return fn.includes(q) || pn.includes(q) || ps.includes(q);
  });

  if (filtered.length === 0) {
    box.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 12px;">Không tìm thấy hồ sơ nào khớp từ khóa.</div>`;
    return;
  }

  box.innerHTML = filtered.map(p => {
    const fn = p.filename || p.file;
    const isSel = fn === sdStudioSelectedFilename;
    const isAct = Boolean(p.is_active);
    const isExp = sdProfileExpandedCards.has(fn);
    const tagCnt = p.tagged_total !== undefined ? `${p.tagged_total} Tag` : `${p.total_registers || 0} Ô`;
    const skipHtml = p.disabled_total ? `<span class="badge badge-amber" style="font-size: 10px;">🚫 Né ${p.disabled_total}</span>` : '';
    const safePn = (p.profile_name || fn).replace(/'/g, "\\'");
    return `
      <div class="sd-profile-card ${isSel ? 'selected' : ''} ${isAct ? 'active-running' : ''}" onclick="inspectSdProfileFile('${fn}')">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div style="font-weight: 800; color: #fff; font-size: 13px; line-height: 1.3; word-break: break-word;">
            ${p.profile_name}
          </div>
          ${isAct ? '<span class="badge badge-emerald" style="font-size: 9px; flex-shrink: 0;">ĐANG CHẠY</span>' : ''}
        </div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
          <span class="badge badge-cyan" style="font-size: 10px;">${p.tabs_count} Tab</span>
          <span class="badge badge-emerald" style="font-size: 10px;">🏷️ ${tagCnt}</span>
          ${skipHtml}
          <span class="badge badge-slate" style="font-size: 10px;">🔌 ${p.ports_summary || '--'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; flex-wrap: wrap; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px; margin-top: 2px;" onclick="event.stopPropagation();">
          <div style="display: flex; gap: 3px; flex-wrap: wrap;">
            <button class="btn btn-emerald" style="padding: 2px 7px; font-size: 10px;" onclick="loadSdProfileFile('${fn}')" title="Nạp hồ sơ này vào Bảng Dữ Liệu (Poll) và chạy ngay">⚡ Mở Chạy</button>
            <button class="btn btn-outline" style="padding: 2px 6px; font-size: 10px; color: var(--cyan); border-color: rgba(6,182,212,0.4);" onclick="editSdProfileCard('${fn}', event)" title="Chỉnh sửa hồ sơ này">✏️ Sửa</button>
            <button class="btn btn-outline" style="padding: 2px 6px; font-size: 10px;" onclick="cloneSdProfileByFile('${fn}', '${safePn}', event)" title="Nhân bản hồ sơ này">📋</button>
            <button class="btn btn-outline" style="padding: 2px 6px; font-size: 10px; color: var(--rose);" onclick="deleteSdProfileByFile('${fn}', event)" title="Xóa hồ sơ này">🗑️</button>
          </div>
          <button class="btn btn-outline" style="padding: 2px 6px; font-size: 10px; color: #cbd5e1;" onclick="toggleSdProfileCardDetail('${fn}', event)" title="Mở rộng / thu gọn thông tin chi tiết file">
            ${isExp ? '▴ Thu gọn' : '▾ Chi tiết'}
          </button>
        </div>
        <div class="sd-card-extra ${isExp ? 'open' : ''}" onclick="event.stopPropagation();">
          <div style="font-family: monospace; color: var(--cyan); word-break: break-all;">📄 ${fn}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px;">
            <span>Dung lượng: <b>${p.size_kb} KB</b> • Lưu: ${p.updated_at}</span>
          </div>
          <div style="display: flex; gap: 5px; margin-top: 4px; flex-wrap: wrap;">
            <button class="btn btn-outline" style="padding: 2px 7px; font-size: 10px; color: var(--emerald);" onclick="openSdProfileInQuickBuilder('${fn}', event)">⚡ Sửa Nhanh (Form)</button>
            <a href="/api/profile/download?file=${encodeURIComponent(fn)}" class="btn btn-outline" style="padding: 2px 7px; font-size: 10px; text-decoration: none;">⬇ Tải File .JSON</a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function inspectSdProfileFile(fname, tabIdx = 0) {
  if (!fname) return;
  sdStudioSelectedFilename = fname;
  renderSdStudioProfileCards();
  try {
    const res = await fetch(`/api/profile/get?file=${encodeURIComponent(fname)}`);
    const data = await res.json();
    if (!data.success) {
      alert("Không thể đọc chi tiết hồ sơ: " + (data.error || "Lỗi"));
      return;
    }
    sdStudioCurrentDetail = data;
    sdStudioActiveTabIdx = Math.max(0, Math.min(tabIdx, ((data.profile?.polling_tabs || []).length || 1) - 1));
    setSdProfileUnsavedState(false);
    renderSdInspectorFullView();
    if (typeof saveUiStateToStorage === 'function') saveUiStateToStorage();
  } catch (e) {
    alert("Lỗi khi tải chi tiết hồ sơ SD: " + e);
  }
}

function recomputeLocalTabAnalysis(tabObj, idx) {
  const sAddr = parseInt(tabObj.start_addr || 0);
  const cnt = Math.max(1, Math.min(parseInt(tabObj.count || 10), 250));
  const fnCode = parseInt(tabObj.fn_code || 3);
  const onlyTg = Boolean(tabObj.only_tagged);
  const tags = tabObj.tags || {};
  const units = tabObj.units || {};
  const scales = tabObj.scales || {};

  const fakeTab = {
    start_addr: sAddr,
    count: cnt,
    disabled_addrs: tabObj.disabled_addrs || [],
    only_tagged: onlyTg,
    tags: tags
  };
  const subBlocks = computeLocalSubBlocks(fakeTab);
  const disSet = getEffectiveDisabledSet(fakeTab);
  const actDis = [];
  for (let i = 0; i < cnt; i++) {
    if (disSet.has(sAddr + i)) actDis.push(sAddr + i);
  }
  let tagCnt = 0;
  Object.values(tags).forEach(v => { if (String(v || '').trim()) tagCnt++; });

  return {
    index: idx,
    id: tabObj.id || `tab_${idx + 1}`,
    name: tabObj.name || `Kênh ${idx + 1}`,
    port: tabObj.port || "/dev/ttyCH0",
    port_label: shortPortLabel(tabObj.port || "/dev/ttyCH0"),
    baud: parseInt(tabObj.baud || 9600),
    parity: (tabObj.parity || "N").toUpperCase(),
    stopbits: parseInt(tabObj.stopbits || 1),
    slave_id: parseInt(tabObj.slave_id || 1),
    fn_code: fnCode,
    start_addr: sAddr,
    end_addr: sAddr + cnt - 1,
    count: cnt,
    enabled_count: cnt - actDis.length,
    disabled_count: actDis.length,
    disabled_addrs: actDis,
    disabled_ranges_str: formatAddrRangeSet(actDis),
    only_tagged: onlyTg,
    tagged_count: tagCnt,
    sub_blocks: subBlocks,
    sub_blocks_count: subBlocks.length,
    format: tabObj.format || "uint16",
    scan_ms: parseInt(tabObj.scan_ms || 1000),
    tags: tags,
    units: units,
    scales: scales
  };
}

function renderSdInspectorFullView() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const d = sdStudioCurrentDetail;
  const prof = d.profile;
  const tabs = Array.isArray(prof.polling_tabs) ? prof.polling_tabs : [];

  const computedTabs = tabs.map((t, i) => recomputeLocalTabAnalysis(t, i));
  const totRegs = computedTabs.reduce((s, x) => s + x.count, 0);
  const totDis = computedTabs.reduce((s, x) => s + x.disabled_count, 0);
  const totEn = totRegs - totDis;
  const totTag = computedTabs.reduce((s, x) => s + x.tagged_count, 0);
  const totSub = computedTabs.reduce((s, x) => s + x.sub_blocks_count, 0);
  const portsSet = [...new Set(computedTabs.map(x => x.port_label))];

  document.getElementById('lblSdInspectTitle').textContent = prof.profile_name || d.filename;
  const actBadge = document.getElementById('badgeSdInspectActive');
  if (actBadge) actBadge.style.display = d.is_active ? 'inline-flex' : 'none';
  document.getElementById('badgeSdInspectMeta').textContent = `${d.size_kb || '--'} KB • Lưu lúc: ${d.updated_at || '--'}`;
  document.getElementById('lblSdInspectFilepath').textContent = d.path || `/mnt/sda1/modbus_data/profiles/${d.filename}`;

  const compactSummary = document.getElementById('lblSdCompactKpiSummary');
  if (compactSummary) {
    compactSummary.innerHTML = `<span class="badge badge-cyan">${computedTabs.length} Tab</span> <span class="badge badge-emerald">☑ Đọc ${totEn}/${totRegs}</span> <span class="badge badge-amber">🚫 Né ${totDis}</span> <span class="badge badge-cyan">📦 ${totSub} Khối</span>`;
  }

  document.getElementById('kpiSdTabs').textContent = computedTabs.length;
  document.getElementById('kpiSdPorts').textContent = `Cổng: ${portsSet.join(', ') || '--'}`;
  document.getElementById('kpiSdEnabled').textContent = `${totEn} / ${totRegs}`;
  document.getElementById('kpiSdTagged').textContent = `🏷️ ${totTag} điểm có tên Tag`;
  document.getElementById('kpiSdDisabled').textContent = totDis;
  document.getElementById('kpiSdSubBlocks').textContent = totSub;

  const alBox = document.getElementById('sdInspectAliasesBox');
  const aliases = prof.port_aliases || {};
  const aliasKeys = Object.keys(aliases);
  if (alBox) {
    if (aliasKeys.length === 0) {
      alBox.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">Chưa khai báo Port Alias trong hồ sơ này.</span>`;
    } else {
      alBox.innerHTML = `<span style="font-size: 11px; font-weight: 700; color: var(--cyan);">🔌 Sơ Đồ Đấu Nối Cổng COM:</span>` +
        aliasKeys.map(k => `<span class="badge badge-slate" style="font-size: 11px; border-color: rgba(6,182,212,0.35);"><b style="color: var(--cyan);">${shortPortLabel(k)}</b>: ${aliases[k]}</span>`).join('');
    }
  }

  const chipsBox = document.getElementById('sdInspectTabChips');
  if (chipsBox) {
    chipsBox.innerHTML = computedTabs.map((ct, idx) => `
      <div class="sd-tab-chip ${idx === sdStudioActiveTabIdx ? 'active' : ''}" onclick="selectSdInspectorTab(${idx})">
        <span style="color: var(--cyan); font-family: monospace; font-weight: 800;">#${idx + 1} [${ct.port_label}]</span>
        <span>${ct.name}</span>
        <span class="badge badge-emerald" style="font-size: 9px; padding: 1px 5px;">${ct.tagged_count} Tag</span>
        ${ct.disabled_count > 0 ? `<span class="badge badge-amber" style="font-size: 9px; padding: 1px 5px;">🚫 Né ${ct.disabled_count}</span>` : ''}
      </div>
    `).join('');
  }

  renderSdInspectorActiveTabSummary(computedTabs[sdStudioActiveTabIdx]);
  renderSdInspectorRegisterTable();

  const matrixTbody = document.getElementById('tblSdInspectorAllTabsMatrix');
  if (matrixTbody) {
    matrixTbody.innerHTML = computedTabs.map((ct, idx) => {
      const blkVisual = buildVisualSubBlocksHtml(ct);
      return `
        <tr style="cursor: pointer;" onclick="selectSdInspectorTab(${idx}); switchSdInspectorTab('visual');">
          <td class="col-addr">${idx + 1}</td>
          <td>
            <div style="font-weight: 700; color: #fff;">${ct.name}</div>
            <div style="font-size: 10px; color: var(--text-muted); font-family: monospace;">ID: ${ct.id} • Quét ${ct.scan_ms}ms • ${ct.format.toUpperCase()}</div>
          </td>
          <td>
            <span class="badge badge-cyan">${ct.port_label}</span>
            <div style="font-family: monospace; font-size: 11px; color: #cbd5e1; margin-top: 3px;">${ct.baud} 8${ct.parity}${ct.stopbits}</div>
          </td>
          <td style="font-family: monospace;">
            <b style="color: var(--emerald);">Slave ${ct.slave_id}</b><br>
            <span style="font-size: 11px; color: var(--text-muted);">FC0${ct.fn_code}</span>
          </td>
          <td style="font-family: monospace; color: var(--cyan); font-weight: 700;">
            ${ct.start_addr} .. ${ct.end_addr}<br>
            <span style="font-size: 10px; color: var(--text-muted);">(${ct.count} thanh ghi)</span>
          </td>
          <td>
            <span class="badge badge-emerald">☑ Đọc ${ct.enabled_count}</span>
            <span class="badge badge-cyan">🏷️ ${ct.tagged_count} Tag</span>
            ${ct.disabled_count > 0 ? `<span class="badge badge-amber">🚫 Né ${ct.disabled_count}</span>` : ''}
          </td>
          <td><div style="display: flex; gap: 5px; flex-wrap: wrap;">${blkVisual}</div></td>
        </tr>
      `;
    }).join('');
  }

  const rawTxt = document.getElementById('txtSdInspectorRawJson');
  if (rawTxt) {
    rawTxt.value = JSON.stringify(prof, null, 2);
  }
}

function buildVisualSubBlocksHtml(ct) {
  if (!ct) return '';
  const segments = [];
  const disSet = new Set(ct.disabled_addrs || []);
  let i = 0;
  while (i < ct.count) {
    const addr = ct.start_addr + i;
    const isDis = disSet.has(addr);
    let j = i;
    while (j + 1 < ct.count && disSet.has(ct.start_addr + j + 1) === isDis) {
      j++;
    }
    const segStart = ct.start_addr + i;
    const segEnd = ct.start_addr + j;
    const segLen = j - i + 1;
    if (isDis) {
      segments.push(`<span class="subblock-pill-skip" title="Vùng địa chỉ bị Cấm Đọc — tuyệt đối không gửi lệnh Modbus chạm vào vùng này">🚫 Né [${segStart === segEnd ? segStart : segStart + '..' + segEnd}] (${segLen} ô)</span>`);
    } else {
      segments.push(`<span class="subblock-pill-ok" title="Khối lệnh đọc Modbus RTU hợp lệ liên tiếp">📦 Đọc [${segStart === segEnd ? segStart : segStart + '..' + segEnd}] (${segLen} ô)</span>`);
    }
    i = j + 1;
  }
  return segments.join(' <span style="color:#64748b;">→</span> ');
}

function selectSdInspectorTab(idx) {
  sdStudioActiveTabIdx = idx;
  renderSdInspectorFullView();
  if (typeof saveUiStateToStorage === 'function') saveUiStateToStorage();
}

function renderSdInspectorActiveTabSummary(ct) {
  const box = document.getElementById('sdInspectActiveTabSummary');
  if (!box) return;
  if (!ct) {
    box.innerHTML = `<div style="color: var(--text-muted); font-size: 12px;">Không có Tab nào trong hồ sơ. Nhấn <b>➕ Thêm Tab</b> để tạo Tab thiết bị.</div>`;
    return;
  }
  const blkHtml = buildVisualSubBlocksHtml(ct);
  const subDetailBox = document.getElementById('sdInspectSubBlocksDetailBox');
  if (subDetailBox) {
    subDetailBox.innerHTML = blkHtml;
  }

  const portList = (availablePortsCache && availablePortsCache.length > 0)
    ? availablePortsCache
    : Array.from({ length: 8 }, (_, i) => ({ id: `/dev/ttyCH${i}`, label: `COM ${i + 1} (/dev/ttyCH${i})` }));
  const portOpts = portList.map(p => `<option value="${p.id}" ${p.id === ct.port ? 'selected' : ''}>${p.label}</option>`).join('');
  const baudOpts = STANDARD_BAUDS.map(b => `<option value="${b}" ${Number(b) === Number(ct.baud) ? 'selected' : ''}>${b} bps</option>`).join('');
  const curFraming = `${ct.parity || 'N'}-${ct.stopbits || 1}`;

  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;">
        <span class="badge badge-cyan" style="font-size: 11px;">⚙️ Tab #${ct.index + 1}</span>
        <strong style="font-size: 12px; color: #fff; word-break: break-word;">${ct.name}</strong>
        <span class="badge badge-emerald" style="font-size: 10px;">📦 ${ct.sub_blocks_count} khối lệnh RTU</span>
        ${ct.disabled_count > 0 ? `<span class="badge badge-amber" style="font-size: 10px;">🚫 Né ${ct.disabled_count} ô cấm</span>` : ''}
      </div>
      <span style="font-size: 11px; color: var(--text-muted);">Chỉnh sửa trực tiếp — nhấn <b>💾 Lưu Vào SD</b> để ghi bền vững</span>
    </div>

    <!-- INLINE TAB PARAMETER EDITOR (PRIMARY CONTENT) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 6px; background: rgba(2,6,23,0.45); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 8px 10px;">
      <div class="field-box">
        <label>Tên Tab Thiết Bị</label>
        <input type="text" value="${(ct.name || '').replace(/"/g, '&quot;')}" onchange="sdInspectorUpdateTabField('name', this.value)" style="padding: 4px 7px; font-size: 12px;">
      </div>
      <div class="field-box">
        <label>Cổng RS485</label>
        <select onchange="sdInspectorUpdateTabField('port', this.value)" style="padding: 4px 6px; font-size: 12px;">${portOpts}</select>
      </div>
      <div class="field-box">
        <label>Baudrate</label>
        <select onchange="sdInspectorUpdateTabField('baud', parseInt(this.value) || 9600)" style="padding: 4px 6px; font-size: 12px;">${baudOpts}</select>
      </div>
      <div class="field-box">
        <label>Framing</label>
        <select onchange="sdInspectorUpdateTabField('framing', this.value)" style="padding: 4px 6px; font-size: 12px;">
          <option value="N-1" ${curFraming === 'N-1' ? 'selected' : ''}>8N1</option>
          <option value="E-1" ${curFraming === 'E-1' ? 'selected' : ''}>8E1</option>
          <option value="O-1" ${curFraming === 'O-1' ? 'selected' : ''}>8O1</option>
          <option value="N-2" ${curFraming === 'N-2' ? 'selected' : ''}>8N2</option>
        </select>
      </div>
      <div class="field-box">
        <label>Slave ID</label>
        <input type="number" min="1" max="247" value="${ct.slave_id}" onchange="sdInspectorUpdateTabField('slave_id', parseInt(this.value) || 1)" style="padding: 4px 7px; font-size: 12px;">
      </div>
      <div class="field-box">
        <label>Hàm (FC)</label>
        <select onchange="sdInspectorUpdateTabField('fn_code', parseInt(this.value) || 3)" style="padding: 4px 6px; font-size: 12px;">
          <option value="3" ${ct.fn_code === 3 ? 'selected' : ''}>FC03 (4x)</option>
          <option value="4" ${ct.fn_code === 4 ? 'selected' : ''}>FC04 (3x)</option>
          <option value="1" ${ct.fn_code === 1 ? 'selected' : ''}>FC01 (0x)</option>
          <option value="2" ${ct.fn_code === 2 ? 'selected' : ''}>FC02 (1x)</option>
        </select>
      </div>
      <div class="field-box">
        <label>Địa Chỉ Đầu</label>
        <input type="number" min="0" max="65535" value="${ct.start_addr}" onchange="sdInspectorUpdateTabField('start_addr', parseInt(this.value) || 0)" style="padding: 4px 7px; font-size: 12px;">
      </div>
      <div class="field-box">
        <label>Số Lượng (1..250)</label>
        <input type="number" min="1" max="250" value="${ct.count}" onchange="sdInspectorUpdateTabField('count', Math.max(1, Math.min(250, parseInt(this.value) || 10)))" style="padding: 4px 7px; font-size: 12px;">
      </div>
      <div class="field-box" style="grid-column: span 2;">
        <label style="color: var(--amber);">🚫 Dải Địa Chỉ Cấm Đọc Ở Giữa</label>
        <input type="text" value="${(ct.disabled_ranges_str || '').replace(/"/g, '&quot;')}" placeholder="VD: 3-5, 8-10, 12"
               onchange="sdInspectorUpdateTabField('disabled_addrs', this.value)"
               style="padding: 4px 7px; font-size: 12px; font-family: monospace; color: #fde68a; border-color: rgba(245,158,11,0.35);">
      </div>
    </div>
  `;
}

function sdInspectorUpdateTabField(field, val) {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const tabs = sdStudioCurrentDetail.profile.polling_tabs || [];
  const rawTab = tabs[sdStudioActiveTabIdx];
  if (!rawTab) return;

  if (field === 'framing') {
    const fp = String(val || 'N-1').split('-');
    rawTab.parity = (fp[0] || 'N').toUpperCase();
    rawTab.stopbits = parseInt(fp[1]) || 1;
  } else if (field === 'disabled_addrs') {
    rawTab.disabled_addrs = Array.from(parseAddrRangeSet(val)).sort((a, b) => a - b);
    rawTab.only_tagged = false;
  } else {
    rawTab[field] = val;
  }
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
}

function sdInspectorAddNewTab() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  if (!Array.isArray(sdStudioCurrentDetail.profile.polling_tabs)) {
    sdStudioCurrentDetail.profile.polling_tabs = [];
  }
  const tabs = sdStudioCurrentDetail.profile.polling_tabs;
  const nextIdx = tabs.length + 1;
  tabs.push({
    id: `tab_${nextIdx}`,
    name: `COM ${((nextIdx - 1) % 8) + 1} • Thiết Bị #${nextIdx}`,
    port: `/dev/ttyCH${(nextIdx - 1) % 8}`,
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
    tags: {},
    units: {},
    scales: {}
  });
  sdStudioActiveTabIdx = tabs.length - 1;
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
  showToast(`Đã thêm Tab #${nextIdx}. Nhấn '💾 Lưu Vào SD' để lưu bền vững!`);
}

function sdInspectorCloneActiveTab() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const tabs = sdStudioCurrentDetail.profile.polling_tabs || [];
  const src = tabs[sdStudioActiveTabIdx];
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = `tab_${tabs.length + 1}_${Date.now().toString().slice(-3)}`;
  copy.name = `${src.name || 'Kênh'} (Bản sao)`;
  tabs.splice(sdStudioActiveTabIdx + 1, 0, copy);
  sdStudioActiveTabIdx = sdStudioActiveTabIdx + 1;
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
  showToast(`📋 Đã nhân bản Tab '${copy.name}'. Nhấn '💾 Lưu Vào SD' để ghi lại!`);
}

function sdInspectorDeleteActiveTab() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const tabs = sdStudioCurrentDetail.profile.polling_tabs || [];
  if (tabs.length <= 1) {
    alert("Hồ sơ phải có ít nhất 1 Tab!");
    return;
  }
  tabs.splice(sdStudioActiveTabIdx, 1);
  sdStudioActiveTabIdx = Math.max(0, sdStudioActiveTabIdx - 1);
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
  showToast("Đã xóa Tab khỏi hồ sơ. Nhấn '💾 Lưu Vào SD' để ghi lại!");
}

function renderSdInspectorRegisterTable() {
  const tbody = document.getElementById('tblSdInspectorRegisters');
  if (!tbody || !sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const tabs = sdStudioCurrentDetail.profile.polling_tabs || [];
  const rawTab = tabs[sdStudioActiveTabIdx];
  if (!rawTab) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 16px;">Không có dữ liệu Tab.</td></tr>`;
    return;
  }

  const ct = recomputeLocalTabAnalysis(rawTab, sdStudioActiveTabIdx);
  const disSet = new Set(ct.disabled_addrs || []);
  const filterMode = document.getElementById('selSdInspRegFilter')?.value || 'all';
  const searchQ = (document.getElementById('inpSdInspRegSearch')?.value || '').trim().toLowerCase();

  const addrToBlockMap = {};
  (ct.sub_blocks || []).forEach((b, bIdx) => {
    for (let k = 0; k < b.count; k++) {
      addrToBlockMap[b.start_addr + k] = `Khối #${bIdx + 1} [${b.start_addr}..${b.start_addr + b.count - 1}]`;
    }
  });

  const rowsHtml = [];
  for (let i = 0; i < ct.count; i++) {
    const addr = ct.start_addr + i;
    const hexAddr = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
    let plcBase = 40001;
    if (ct.fn_code === 1) plcBase = 1;
    else if (ct.fn_code === 2) plcBase = 10001;
    else if (ct.fn_code === 4) plcBase = 30001;
    const plcAddr = plcBase + addr;

    const isDis = disSet.has(addr);
    const tagVal = String(getPointMeta(rawTab.tags, i, ct.start_addr, "") || "");
    const unitVal = String(getPointMeta(rawTab.units, i, ct.start_addr, "") || "");
    const scaleVal = getPointMeta(rawTab.scales, i, ct.start_addr, 1);

    if (filterMode === 'tagged' && !tagVal.trim()) continue;
    if (filterMode === 'enabled' && isDis) continue;
    if (filterMode === 'disabled' && !isDis) continue;

    if (searchQ) {
      const matchStr = `${addr} ${hexAddr} ${plcAddr} ${tagVal} ${unitVal}`.toLowerCase();
      if (!matchStr.includes(searchQ)) continue;
    }

    const blkLabel = isDis
      ? `<span class="badge badge-amber">🚫 CẤM ĐỌC (NÉ)</span>`
      : `<span class="badge badge-emerald">${addrToBlockMap[addr] || 'ĐỌC'}</span>`;

    rowsHtml.push(`
      <tr style="${isDis ? 'opacity: 0.56; background: rgba(245,158,11,0.04);' : ''}">
        <td style="text-align: center;">
          <input type="checkbox" ${!isDis ? 'checked' : ''} onchange="sdInspectorToggleAddr(${addr}, this.checked)" title="Tích chọn để Đọc thanh ghi ${addr}, bỏ tích để Cấm Đọc (tự động tách khối né địa chỉ này)">
        </td>
        <td class="col-addr">${i + 1}</td>
        <td class="col-addr" style="color: ${isDis ? 'var(--amber)' : 'var(--cyan)'}; font-weight: 700;">${addr}</td>
        <td class="col-hex">${hexAddr}</td>
        <td class="col-plc">${plcAddr}</td>
        <td>
          <input type="text" value="${tagVal.replace(/"/g, '&quot;')}" placeholder="-- Nhập tên Tag --"
                 style="width: 100%; padding: 3px 7px; font-size: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); color: #fff; font-weight: ${tagVal ? '700' : '400'};"
                 onchange="sdInspectorUpdatePointMeta(${i}, ${addr}, 'tags', this.value)">
        </td>
        <td>
          <input type="text" value="${unitVal.replace(/"/g, '&quot;')}" placeholder="Đơn vị"
                 style="width: 68px; padding: 3px 6px; font-size: 11px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);"
                 onchange="sdInspectorUpdatePointMeta(${i}, ${addr}, 'units', this.value)">
        </td>
        <td>
          <input type="number" step="any" value="${scaleVal}"
                 style="width: 72px; padding: 3px 6px; font-size: 11px; font-family: monospace; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);"
                 onchange="sdInspectorUpdatePointMeta(${i}, ${addr}, 'scales', parseFloat(this.value) || 1)">
        </td>
        <td>${blkLabel}</td>
      </tr>
    `);
  }

  tbody.innerHTML = rowsHtml.length > 0
    ? rowsHtml.join('')
    : `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 18px;">Không có dòng thanh ghi nào khớp bộ lọc hiện tại.</td></tr>`;
}

function sdInspectorToggleAddr(addr, enabled) {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const rawTab = (sdStudioCurrentDetail.profile.polling_tabs || [])[sdStudioActiveTabIdx];
  if (!rawTab) return;
  rawTab.only_tagged = false;
  const set = parseAddrRangeSet(rawTab.disabled_addrs);
  if (enabled) set.delete(addr);
  else set.add(addr);
  rawTab.disabled_addrs = [...set].sort((a, b) => a - b);
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
}

function sdInspectorUpdatePointMeta(offsetIdx, absAddr, field, val) {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const rawTab = (sdStudioCurrentDetail.profile.polling_tabs || [])[sdStudioActiveTabIdx];
  if (!rawTab) return;
  if (!rawTab[field] || typeof rawTab[field] !== 'object') rawTab[field] = {};
  const mapObj = rawTab[field];
  const sAddr = parseInt(rawTab.start_addr || 0);
  if (`@${absAddr}` in mapObj) {
    mapObj[`@${absAddr}`] = val;
  } else if (isTagMapAddressKeyed(mapObj, sAddr)) {
    mapObj[String(absAddr)] = val;
  } else {
    mapObj[String(offsetIdx)] = val;
  }
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
}

function sdInspectorMaskUntaggedInTab() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const rawTab = (sdStudioCurrentDetail.profile.polling_tabs || [])[sdStudioActiveTabIdx];
  if (!rawTab) return;
  const sAddr = parseInt(rawTab.start_addr || 0);
  const cnt = parseInt(rawTab.count || 10);
  const set = new Set();
  for (let i = 0; i < cnt; i++) {
    const tg = getPointMeta(rawTab.tags, i, sAddr, "");
    if (!String(tg || "").trim()) set.add(sAddr + i);
  }
  rawTab.disabled_addrs = [...set].sort((a, b) => a - b);
  rawTab.only_tagged = false;
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
  showToast(`Đã đánh dấu Cấm Đọc ${set.size} thanh ghi trống Tag trong Tab #${sdStudioActiveTabIdx + 1}. Nhấn '💾 Lưu Vào SD' để ghi bền vững!`);
}

function sdInspectorEnableAllInTab() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const rawTab = (sdStudioCurrentDetail.profile.polling_tabs || [])[sdStudioActiveTabIdx];
  if (!rawTab) return;
  rawTab.disabled_addrs = [];
  rawTab.only_tagged = false;
  setSdProfileUnsavedState(true);
  renderSdInspectorFullView();
  showToast(`Đã bật đọc tất cả thanh ghi trong Tab #${sdStudioActiveTabIdx + 1}.`);
}

async function saveSelectedSdProfileChanges() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  try {
    const res = await fetch('/api/profile/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: sdStudioCurrentDetail.filename,
        profile: sdStudioCurrentDetail.profile
      })
    });
    const data = await res.json();
    if (data.success) {
      setSdProfileUnsavedState(false);
      if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, sdStudioCurrentDetail.filename);
      await inspectSdProfileFile(sdStudioCurrentDetail.filename, sdStudioActiveTabIdx);
      showToast(`Đã lưu cập nhật hồ sơ '${sdStudioCurrentDetail.profile.profile_name}' vào Thẻ nhớ SD!`);
    } else {
      alert("Lỗi lưu hồ sơ: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi lưu hồ sơ: " + e);
  }
}

async function saveSdInspectorRawJson() {
  const txt = document.getElementById('txtSdInspectorRawJson');
  if (!txt || !sdStudioCurrentDetail) return;
  try {
    const parsed = JSON.parse(txt.value);
    sdStudioCurrentDetail.profile = parsed;
    await saveSelectedSdProfileChanges();
  } catch (e) {
    alert("Lỗi cú pháp JSON! Vui lòng kiểm tra lại dấu phẩy hoặc ngoặc kép:\n" + e);
  }
}

function formatSdInspectorJson() {
  const txt = document.getElementById('txtSdInspectorRawJson');
  if (!txt) return;
  try {
    const parsed = JSON.parse(txt.value);
    txt.value = JSON.stringify(parsed, null, 2);
    showToast("Đã định dạng đẹp mã JSON!");
  } catch (e) {
    alert("JSON không hợp lệ: " + e);
  }
}

function copySdInspectorJson() {
  const txt = document.getElementById('txtSdInspectorRawJson');
  if (!txt) return;
  navigator.clipboard.writeText(txt.value).then(() => {
    showToast("Đã sao chép toàn bộ mã JSON vào bộ nhớ tạm!");
  });
}

async function activateSelectedSdProfile() {
  if (!sdStudioSelectedFilename) return;
  await loadSdProfileFile(sdStudioSelectedFilename);
}

function downloadSelectedSdProfile() {
  if (!sdStudioSelectedFilename) return;
  window.location.href = `/api/profile/download?file=${encodeURIComponent(sdStudioSelectedFilename)}`;
}

function exportAllSdProfilesBundle() {
  window.location.href = '/api/profile/export_all';
  showToast("Đang tải gói Backup toàn bộ hồ sơ Thẻ nhớ SD (.JSON Bundle)...");
}

async function saveActiveWorkspaceFromSdStudio() {
  const defaultName = currentProfileName || "NXChieu_MultiPort_Profile";
  const nameInput = prompt("Nhập tên hồ sơ để lưu phiên làm việc hiện tại vào Thẻ nhớ SD:", defaultName);
  if (!nameInput || !nameInput.trim()) return;
  await doSaveProfileToSd(nameInput.trim());
  await loadSdProfileStudio(true);
}

async function createNewBlankSdProfile() {
  const nameInput = prompt("Nhập tên Hồ Sơ Mới để tạo trên Thẻ nhớ SD:", `Ho_So_Moi_${new Date().toISOString().slice(11,16).replace(':','')}`);
  if (!nameInput || !nameInput.trim()) return;
  const blankProf = {
    schema: "nxmodbus-monitor-v3.3",
    profile_name: nameInput.trim(),
    created_at: new Date().toISOString(),
    port_aliases: { "/dev/ttyCH0": "COM 1 Thiết Bị" },
    polling_tabs: [
      {
        id: "tab_1",
        name: "COM 1 • Thiết Bị #1",
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
        tags: { "0": "Thanh ghi 0" },
        units: {},
        scales: {}
      }
    ]
  };
  try {
    const res = await fetch('/api/profile/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: blankProf.profile_name,
        profile: blankProf
      })
    });
    const data = await res.json();
    if (data.success) {
      const savedFn = (data.imported_items && data.imported_items[0]) ? data.imported_items[0].filename : '';
      if (savedFn) sdStudioSelectedFilename = savedFn;
      if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, savedFn);
      await inspectSdProfileFile(savedFn || sdStudioSelectedFilename, 0);
      showToast(`➕ Đã tạo hồ sơ mới '${blankProf.profile_name}' trên Thẻ nhớ SD!`);
    } else {
      alert("Lỗi tạo hồ sơ mới: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối: " + e);
  }
}

async function openSelectedSdProfileInQuickBuilder() {
  if (!sdStudioCurrentDetail || !sdStudioCurrentDetail.profile) return;
  const prof = sdStudioCurrentDetail.profile;
  const modal = document.getElementById('quickProfileBuilderModal');
  if (modal) modal.classList.add('open');
  const nameInp = document.getElementById('inpQbProfileName');
  if (nameInp) nameInp.value = prof.profile_name || sdStudioSelectedFilename.replace(/\.json$/i, '');
  const tabs = Array.isArray(prof.polling_tabs) ? prof.polling_tabs : [];
  quickBuilderTabs = tabs.map(t => ({
    name: t.name || "Kênh",
    port: t.port || "/dev/ttyCH0",
    baud: parseInt(t.baud) || 9600,
    framing: `${(t.parity || 'N').toUpperCase()}-${parseInt(t.stopbits) || 1}`,
    slave_id: parseInt(t.slave_id) || 1,
    fn_code: parseInt(t.fn_code) || 3,
    start_addr: parseInt(t.start_addr) || 0,
    count: parseInt(t.count) || 10,
    disabled_addrs: formatAddrRangeString(parseAddrRangeSet(t.disabled_addrs)),
    format: t.format || "uint16",
    scan_ms: parseInt(t.scan_ms) || 1000,
    tags_spec: formatQuickTagsSpec(t.tags || {}, t.units || {}, t.scales || {}, parseInt(t.start_addr) || 0)
  }));
  if (quickBuilderTabs.length === 0) addQuickBuilderTabRow();
  else renderQuickBuilderTabsList();
}

async function openSdProfileInQuickBuilder(fn, ev) {
  if (ev) ev.stopPropagation();
  await inspectSdProfileFile(fn, 0);
  await openSelectedSdProfileInQuickBuilder();
}

async function renameSelectedSdProfile() {
  if (!sdStudioCurrentDetail || !sdStudioSelectedFilename) return;
  const curName = sdStudioCurrentDetail.profile?.profile_name || sdStudioSelectedFilename.replace(/\.json$/i, '');
  const newName = prompt("Nhập tên mới cho hồ sơ này trên Thẻ nhớ SD:", curName);
  if (!newName || !newName.trim() || newName.trim() === curName) return;
  try {
    const res = await fetch('/api/profile/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: sdStudioSelectedFilename,
        new_profile_name: newName.trim()
      })
    });
    const data = await res.json();
    if (data.success) {
      sdStudioSelectedFilename = data.new_filename;
      if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, data.new_filename);
      await inspectSdProfileFile(data.new_filename, sdStudioActiveTabIdx);
      showToast(data.message);
    } else {
      alert("Lỗi đổi tên: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi đổi tên: " + e);
  }
}

async function cloneSdProfileByFile(fn, curName, ev) {
  if (ev) ev.stopPropagation();
  const baseName = curName || fn.replace(/\.json$/i, '');
  const copyName = prompt("Nhập tên cho bản sao (Clone) của hồ sơ này:", `${baseName}_BanSao`);
  if (!copyName || !copyName.trim()) return;
  try {
    const res = await fetch('/api/profile/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: fn,
        new_profile_name: copyName.trim()
      })
    });
    const data = await res.json();
    if (data.success) {
      sdStudioSelectedFilename = data.cloned_file;
      if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, data.cloned_file);
      await inspectSdProfileFile(data.cloned_file, 0);
      showToast(data.message);
    } else {
      alert("Lỗi nhân bản: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi nhân bản: " + e);
  }
}

async function cloneSelectedSdProfile() {
  if (!sdStudioCurrentDetail || !sdStudioSelectedFilename) return;
  const curName = sdStudioCurrentDetail.profile?.profile_name || sdStudioSelectedFilename.replace(/\.json$/i, '');
  await cloneSdProfileByFile(sdStudioSelectedFilename, curName);
}

async function deleteSdProfileByFile(fn, ev) {
  if (ev) ev.stopPropagation();
  await deleteSdProfileFile(fn);
  if (sdStudioSelectedFilename === fn) {
    sdStudioSelectedFilename = "";
    sdStudioCurrentDetail = null;
  }
  await loadSdProfileStudio(true);
}

async function deleteSelectedSdProfile() {
  if (!sdStudioSelectedFilename) return;
  await deleteSdProfileByFile(sdStudioSelectedFilename);
}

async function handleSdStudioBatchImport(ev) {
  const files = Array.from(ev.target.files || []);
  if (files.length === 0) return;
  await processImportedProfileFiles(files);
  ev.target.value = '';
}

async function handleSdStudioFileDrop(ev) {
  ev.preventDefault();
  const dz = document.getElementById('sdStudioDropZone');
  if (dz) dz.classList.remove('dragover');
  const files = Array.from(ev.dataTransfer?.files || []).filter(f => f.name.toLowerCase().endsWith('.json') || f.name.toLowerCase().endsWith('.nxmodbus'));
  if (files.length === 0) {
    alert("Vui lòng kéo thả file có đuôi .json!");
    return;
  }
  await processImportedProfileFiles(files);
}

async function processImportedProfileFiles(files) {
  const autoActivate = Boolean(document.getElementById('chkSdImportAutoActivate')?.checked);
  const batchProfiles = [];
  let lastSingleObj = null;

  for (const f of files) {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.profiles)) {
        parsed.profiles.forEach(item => batchProfiles.push(item));
      } else {
        if (!parsed.profile_name) parsed.profile_name = f.name.replace(/\.json$/i, '');
        batchProfiles.push({ filename: f.name, profile: parsed });
        lastSingleObj = parsed;
      }
    } catch (err) {
      alert(`File '${f.name}' không đúng định dạng JSON:\n${err}`);
      return;
    }
  }

  if (batchProfiles.length === 0) return;

  try {
    const res = await fetch('/api/profile/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: batchProfiles })
    });
    const data = await res.json();
    if (data.success) {
      const firstImported = (data.imported_items && data.imported_items[0]) ? data.imported_items[0].filename : '';
      if (firstImported) sdStudioSelectedFilename = firstImported;
      if (data.saved_profiles) syncSdProfilesDropdown(data.saved_profiles, firstImported);
      await inspectSdProfileFile(sdStudioSelectedFilename, 0);
      showToast(data.message || `Đã Import ${data.imported_count} hồ sơ vào Thẻ nhớ SD!`);
      if (autoActivate && firstImported) {
        await loadSdProfileFile(firstImported);
      } else if (autoActivate && lastSingleObj) {
        await applyProfileJsonObject(lastSingleObj);
      }
    } else {
      alert("Lỗi Import hồ sơ vào Thẻ nhớ SD: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi Import hồ sơ: " + e);
  }
}

function renderSdProfilesModalTable() {
  const tbody = document.getElementById('tblSdProfilesList');
  if (!tbody) return;
  if (!sdProfilesCache || sdProfilesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">Chưa có hồ sơ JSON nào trong Thẻ nhớ SD. Nhấn <b>💾 Lưu Hồ Sơ Đang Mở Vào Thẻ SD</b> hoặc <b>📥 Nạp File Từ Máy Tính</b> để lưu bền vững!</td></tr>`;
    return;
  }
  tbody.innerHTML = sdProfilesCache.map(p => {
    const fn = p.filename || p.file;
    const skipBadge = p.disabled_total ? ` <span class="badge badge-amber">🚫 Né ${p.disabled_total} ô</span>` : '';
    return `
    <tr>
      <td>
        <div style="font-weight: 700; color: #fff; font-size: 13px;">${p.profile_name}${p.is_active ? ' <span class="badge badge-emerald">ĐANG MỞ</span>' : ''}</div>
        <div style="font-size: 11px; color: var(--cyan); font-family: monospace;">/mnt/sda1/modbus_data/profiles/${fn}</div>
      </td>
      <td><span class="badge badge-cyan">${p.tabs_count} Tab</span>${skipBadge}</td>
      <td style="font-family: monospace; color: var(--text-muted);">${p.size_kb} KB</td>
      <td style="font-family: monospace; font-size: 11px; color: #cbd5e1;">${p.updated_at}</td>
      <td>
        <div style="display: flex; gap: 5px; flex-wrap: wrap;">
          <button class="btn btn-emerald" style="padding: 3px 10px; font-size: 11px;" onclick="loadSdProfileFile('${fn}')">⚡ Mở Ngay</button>
          <a href="/api/profile/download?file=${encodeURIComponent(fn)}" class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; text-decoration: none;" title="Tải file JSON này từ thẻ nhớ về máy tính">⬇ Tải</a>
          <button class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; color: var(--rose);" onclick="deleteSdProfileFile('${fn}')" title="Xóa khỏi thẻ nhớ SD">✕</button>
        </div>
      </td>
    </tr>
  `}).join('');
}

async function refreshSdProfilesList() {
  try {
    const res = await fetch('/api/profile/list');
    const data = await res.json();
    if (data.success) {
      syncSdProfilesDropdown(data.profiles || []);
    }
  } catch (e) {}
}

async function quickLoadSdProfile(fname) {
  if (!fname) return;
  await loadSdProfileFile(fname);
}

async function loadSdProfileFile(fname) {
  try {
    const res = await fetch('/api/profile/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fname, file: fname })
    });
    const data = await res.json();
    if (!data.success) {
      alert("Lỗi mở hồ sơ từ Thẻ nhớ SD: " + (data.error || "Thất bại"));
      return;
    }
    if (data.profile && data.profile.profile_name) {
      currentProfileName = data.profile.profile_name;
      const inpName = document.getElementById('inpSdProfileSaveName');
      if (inpName) inpName.value = currentProfileName;
    }
    if (data.port_aliases) portAliasesCache = data.port_aliases;
    if (data.available_ports) {
      availablePortsCache = data.available_ports;
      refreshPortDropdowns();
    }
    const profs = data.saved_profiles || data.sd_profiles || data.profiles;
    if (profs) {
      syncSdProfilesDropdown(profs, fname);
    }
    if (Array.isArray(data.polling_tabs) && data.polling_tabs.length > 0) {
      if (Array.isArray(data.trend_watches) && data.trend_watches.length > 0 && typeof trendWatches !== 'undefined') {
        trendWatches = data.trend_watches;
      } else if (typeof trendWatches !== 'undefined') {
        trendWatches = [];
      }
      hydrateTabsFromProfileArray(data.polling_tabs);
    }
    if (data.profile && data.profile.datalogger && Array.isArray(data.profile.datalogger.channels)) {
      datalogChannelsList = data.profile.datalogger.channels;
      if (typeof renderDatalogChannelsTable === 'function') renderDatalogChannelsTable();
    }
    closeSdProfileModal();
    showView('poll');
    showToast(data.message || `Đã nạp nhanh hồ sơ '${fname}' từ Thẻ nhớ SD!`);
  } catch (e) {
    alert("Lỗi kết nối khi mở hồ sơ SD: " + e);
  }
}

async function saveCurrentProfileToSd() {
  const defaultName = currentProfileName || "NXChieu_MultiPort_Profile";
  const nameInput = prompt("Nhập tên hồ sơ để lưu bền vững vào Thẻ nhớ SD (/mnt/sda1/modbus_data/profiles):", defaultName);
  if (!nameInput || !nameInput.trim()) return;
  await doSaveProfileToSd(nameInput.trim());
}

async function saveCurrentProfileToSdFromModal() {
  const inp = document.getElementById('inpSdProfileSaveName');
  const nameVal = (inp && inp.value.trim()) ? inp.value.trim() : (currentProfileName || "NXChieu_MultiPort_Profile");
  await doSaveProfileToSd(nameVal);
}

async function doSaveProfileToSd(profileName) {
  currentProfileName = profileName;
  const inp = document.getElementById('inpSdProfileSaveName');
  if (inp) inp.value = profileName;
  const exportObj = buildCurrentProfileExportObject(profileName);
  try {
    const res = await fetch('/api/profile/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportObj)
    });
    const data = await res.json();
    if (data.success) {
      const profs = data.saved_profiles || data.sd_profiles || data.profiles;
      if (profs) syncSdProfilesDropdown(profs, data.saved_file || (data.saved && data.saved.filename));
      showToast(data.message || `Đã lưu bền vững vào Thẻ nhớ SD!`);
    } else {
      alert("Lỗi lưu Thẻ nhớ SD: " + (data.error || "Thất bại"));
    }
  } catch (e) {
    alert("Lỗi kết nối khi lưu Thẻ nhớ SD: " + e);
  }
}

async function deleteSdProfileFile(fname) {
  if (!confirm(`Bạn có chắc muốn xóa hồ sơ '${fname}' khỏi Thẻ nhớ SD?`)) return;
  try {
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fname, file: fname })
    });
    const data = await res.json();
    if (data.success) {
      const profs = data.saved_profiles || data.sd_profiles || data.profiles;
      if (profs) syncSdProfilesDropdown(profs);
      showToast(`Đã xóa '${fname}' khỏi Thẻ nhớ SD.`);
    }
  } catch (e) {}
}

function openSdProfileModal() {
  const inp = document.getElementById('inpSdProfileSaveName');
  if (inp && currentProfileName) inp.value = currentProfileName;
  document.getElementById('sdProfileModal').classList.add('open');
  refreshSdProfilesList();
}

function closeSdProfileModal() {
  document.getElementById('sdProfileModal').classList.remove('open');
}
