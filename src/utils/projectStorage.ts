import {
  TabSession,
  RegisterRow,
  RegisterControlConfig,
  SessionRole,
  PollDefinition,
  DataFormat,
} from '../types/modbus';

const STORAGE_KEY = 'nxchieu_modbus_workspace_v1';

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
// Integer in [min, max]; fractions (e.g. Slave ID 1.5) cannot be passed to the Go uint APIs.
const int = (v: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(num(v, fallback))));

export function parseAddrRangeArray(spec: unknown): number[] {
  const out = new Set<number>();
  if (Array.isArray(spec)) {
    spec.forEach((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) out.add(Math.round(item));
      else if (typeof item === 'string') parseAddrRangeArray(item).forEach((x) => out.add(x));
    });
    return [...out].sort((a, b) => a - b);
  }
  if (typeof spec === 'string' && spec.trim()) {
    spec.split(/[,;\s]+/).forEach((tok) => {
      const t = tok.trim();
      if (!t) return;
      if (t.includes('-') || t.includes('..')) {
        const sep = t.includes('..') ? '..' : '-';
        const [p0, p1] = t.split(sep);
        const a = parseInt(p0, 10);
        const b = parseInt(p1, 10);
        if (!isNaN(a) && !isNaN(b)) {
          const lo = Math.min(a, b);
          const hi = Math.min(Math.max(a, b), lo + 2000);
          for (let k = lo; k <= hi; k++) out.add(k);
        }
      } else {
        const n = parseInt(t, 10);
        if (!isNaN(n)) out.add(n);
      }
    });
  }
  return [...out].sort((a, b) => a - b);
}

export function formatAddrRangeString(addrs?: number[]): string {
  if (!addrs || addrs.length === 0) return '';
  const nums = [...new Set(addrs.map((x) => Math.round(x)))].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    const x = nums[i];
    if (x === prev + 1) {
      prev = x;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = prev = x;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}

function mapRouterFormatToDesktop(fmt: unknown): DataFormat {
  const s = String(fmt || '').toLowerCase();
  if (s === 'int16' || s === 'signed16') return 'signed16';
  if (s === 'hex' || s === 'hex16') return 'hex16';
  if (s === 'binary' || s === 'bin16') return 'bin16';
  if (s === 'float_abcd') return 'float_abcd';
  if (s === 'float_cdab') return 'float_cdab';
  return 'unsigned16';
}

function convertRouterTabToDesktopTab(rt: Record<string, any>, idx: number): Record<string, any> {
  const startAddr = int(rt.start_addr ?? rt.start_address, 0, 0, 65535);
  const qty = int(rt.count ?? rt.quantity, 10, 1, 250);
  const aliases: Record<number, string> = {};
  const units: Record<number, string> = {};
  const scalings: Record<number, number> = {};

  const mapMeta = (src: unknown, target: Record<number, any>) => {
    if (!isRecord(src)) return;
    const keys = Object.keys(src);
    const numKeys = keys.filter((k) => /^\d+$/.test(k)).map((k) => parseInt(k, 10));
    const isAbsKeyed = startAddr > 0 && !('0' in src) && numKeys.length > 0 && numKeys.every((nk) => nk >= startAddr);
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || v === '') continue;
      if (k.startsWith('@')) {
        const abs = parseInt(k.slice(1), 10);
        if (!isNaN(abs)) target[abs] = v;
      } else if (/^\d+$/.test(k)) {
        const n = parseInt(k, 10);
        const abs = isAbsKeyed ? n : startAddr + n;
        target[abs] = v;
      }
    }
  };

  mapMeta(rt.tags || rt.aliases, aliases);
  mapMeta(rt.units, units);
  mapMeta(rt.scales || rt.scalings, scalings);

  const controls: Record<number, RegisterControlConfig> = {};
  const rawControls: Record<number, any> = {};
  mapMeta(rt.controls, rawControls);
  for (const [addrStr, c] of Object.entries(rawControls)) {
    const addr = Number(addrStr);
    if (!isRecord(c) || isNaN(addr)) continue;
    const rawType = String(c.type || 'none').toLowerCase();
    if (rawType === 'toggle' || rawType === 'do') {
      controls[addr] = {
        type: 'toggle',
        onValue: num(c.onValue ?? c.on_val, 1),
        offValue: num(c.offValue ?? c.off_val, 0),
      };
    } else if (rawType === 'dropdown' || rawType === 'multistate') {
      const opts: { label: string; value: number }[] = [];
      if (Array.isArray(c.options)) {
        c.options.forEach((o: any) => {
          if (isRecord(o) && o.value !== undefined) {
            opts.push({ value: Number(o.value), label: String(o.label ?? o.value) });
          }
        });
      } else if (typeof c.options === 'string') {
        c.options.split(/[,;|]+/).forEach((part: string) => {
          const idxEq = part.indexOf('=');
          const idxCol = part.indexOf(':');
          const sep = idxEq >= 0 ? idxEq : idxCol;
          if (sep > 0) {
            const v = parseInt(part.slice(0, sep).trim(), 10);
            const lbl = part.slice(sep + 1).trim();
            if (!isNaN(v) && lbl) opts.push({ value: v, label: lbl });
          }
        });
      }
      if (opts.length > 0) {
        controls[addr] = { type: 'dropdown', options: opts };
      }
    } else if (rawType === 'stepper' || rawType === 'number') {
      controls[addr] = {
        type: 'stepper',
        step: num(c.step, 1),
        min: c.min !== undefined ? num(c.min, 0) : undefined,
        max: c.max !== undefined ? num(c.max, 65535) : undefined,
      };
    }
  }

  const disAddrs = parseAddrRangeArray(rt.disabled_addrs || rt.skip_addrs);

  return {
    id: rt.id || `tab-router-${idx + 1}`,
    title: rt.name || rt.title || `Kênh ${idx + 1}`,
    role: 'master',
    definition: {
      slave_id: int(rt.slave_id, 1, 1, 247),
      function_code: int(rt.fn_code ?? rt.function_code, 3, 1, 4),
      start_address: startAddr,
      quantity: qty,
      scan_rate_ms: int(rt.scan_ms ?? rt.scan_rate_ms, 1000, 50, 3600000),
      disabled_addrs: disAddrs,
    },
    format: mapRouterFormatToDesktop(rt.format),
    formats: {},
    aliases,
    units,
    scalings,
    controls,
  };
}

/**
 * Fills missing or malformed fields of a saved/imported tab with defaults.
 */
function normalizeTab(raw: unknown, index: number, usedIds: Set<string>): TabSession | null {
  if (!isRecord(raw)) return null;

  // Support Router v3.2 / v3.3 polling_tabs item format seamlessly
  const src = ('start_addr' in raw || 'fn_code' in raw || 'tags' in raw)
    ? convertRouterTabToDesktopTab(raw, index)
    : raw;

  let id = typeof src.id === 'string' && src.id ? src.id : `tab-${Date.now()}-${index}`;
  if (usedIds.has(id)) id = `${id}-${index}`;
  usedIds.add(id);

  const def = isRecord(src.definition) ? src.definition : {};
  const fc = num(def.function_code, 3);
  const startAddr = int(def.start_address, 0, 0, 65535);
  const slaveStart = int(src.slaveStartAddr, 0, 0, 65535);
  const disabledAddrs = parseAddrRangeArray(def.disabled_addrs ?? src.disabled_addrs);

  return {
    ...(src as Partial<TabSession>),
    id,
    title: typeof src.title === 'string' && src.title ? src.title : `Sheet ${index + 1}`,
    role: src.role === 'slave' ? 'slave' : 'master',
    definition: {
      slave_id: int(def.slave_id, 1, 1, 247),
      function_code: [1, 2, 3, 4].includes(fc) ? fc : 3,
      start_address: startAddr,
      quantity: Math.min(int(def.quantity, 10, 1, 250), 65536 - startAddr),
      scan_rate_ms: int(def.scan_rate_ms, 1000, 50, 3600000),
      disabled_addrs: disabledAddrs,
    },
    format: typeof src.format === 'string' ? (src.format as DataFormat) : 'unsigned16',
    formats: isRecord(src.formats) ? src.formats : {},
    aliases: isRecord(src.aliases) ? src.aliases : {},
    units: isRecord(src.units) ? src.units : {},
    scalings: isRecord(src.scalings) ? src.scalings : {},
    controls: isRecord(src.controls) ? src.controls : {},
    slaveConfig: isRecord(src.slaveConfig) ? (src.slaveConfig as TabSession['slaveConfig']) : undefined,
    slaveTable: ['holding', 'coils', 'discrete', 'input'].includes(src.slaveTable) ? src.slaveTable : 'holding',
    slaveStartAddr: slaveStart,
    slaveQuantity: Math.min(int(src.slaveQuantity, 10, 1, 65535), 65536 - slaveStart),
    isListening: false,
    isSimulating: false,
  } as TabSession;
}

function normalizeTabs(raw: unknown): TabSession[] {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  return raw.map((t, i) => normalizeTab(t, i, usedIds)).filter((t): t is TabSession => t !== null);
}

function pickActiveTabId(tabs: TabSession[], wanted: unknown): string {
  return typeof wanted === 'string' && tabs.some((t) => t.id === wanted) ? wanted : tabs[0].id;
}

export interface ProjectData {
  app: string;
  version: string;
  projectName: string;
  exportedAt: string;
  activeTabId: string;
  tabs: TabSession[];
}

/**
 * Saves current workspace sheets and configurations to browser/webview local storage.
 */
export function saveWorkspace(tabs: TabSession[], activeTabId: string): void {
  try {
    const payload: ProjectData = {
      app: 'NXChieu-Modbus-Tool',
      version: '1.0',
      projectName: 'Default Workspace',
      exportedAt: new Date().toISOString(),
      activeTabId,
      tabs,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to save workspace to localStorage:', err);
  }
}

/**
 * Loads previously saved workspace sheets from localStorage.
 */
export function loadWorkspace(): { tabs: TabSession[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const tabs = normalizeTabs(data?.tabs);
    if (tabs.length > 0) {
      return { tabs, activeTabId: pickActiveTabId(tabs, data.activeTabId) };
    }
  } catch (err) {
    console.warn('Failed to load workspace from localStorage:', err);
  }
  return null;
}

/**
 * Triggers a download of the entire project configuration as a .nxmodbus (JSON) file.
 */
export function exportProjectToFile(tabs: TabSession[], activeTabId: string, projectName: string = 'Modbus_Project'): void {
  const payload: ProjectData = {
    app: 'NXChieu-Modbus-Tool',
    version: '1.0',
    projectName,
    exportedAt: new Date().toISOString(),
    activeTabId,
    tabs,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${projectName.replace(/[^a-zA-Z0-9_\-]/g, '_')}_${timestamp}.nxmodbus`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseProjectJsonString(content: string, fallbackName: string = 'Modbus_Project'): { tabs: TabSession[]; activeTabId: string; projectName: string } {
  const data = JSON.parse(content);
  let rawTabs = data?.tabs || data?.polling_tabs;
  if (!rawTabs && Array.isArray(data?.profiles) && data.profiles.length > 0) {
    const firstProf = data.profiles[0]?.profile || data.profiles[0];
    rawTabs = firstProf?.polling_tabs || firstProf?.tabs;
  }
  const tabs = normalizeTabs(rawTabs);
  if (tabs.length === 0) {
    throw new Error('File không đúng định dạng cấu hình dự án Modbus (thiếu danh sách tabs hoặc polling_tabs).');
  }
  return {
    tabs,
    activeTabId: pickActiveTabId(tabs, data.activeTabId),
    projectName: data.projectName || data.profile_name || fallbackName,
  };
}

/**
 * Parses an uploaded .nxmodbus or .json file and reconstructs the sheets.
 */
export function importProjectFromFile(file: File): Promise<{ tabs: TabSession[]; activeTabId: string; projectName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        resolve(parseProjectJsonString(content, file.name.replace(/\.[^/.]+$/, '')));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Lỗi khi đọc file cấu hình.'));
    reader.readAsText(file);
  });
}

/**
 * Exports register grid data to a standard CSV file for reports and Excel analysis.
 */
export function exportSheetToCSV(tab: TabSession, rows: RegisterRow[]): void {
  const headers = ['#', 'Address', 'Offset', 'Alias', 'Value', 'Raw Hex', 'Unit', 'Scale'];
  const csvLines: string[] = [headers.join(',')];

  rows.forEach((row, idx) => {
    const line = [
      idx + 1,
      `"${row.displayAddress}"`,
      `"+${idx} (${row.address})"`,
      `"${(row.alias || '').replace(/"/g, '""')}"`,
      `"${row.displayValue}"`,
      `"${row.rawHex}"`,
      `"${row.unit || ''}"`,
      row.scaling,
    ];
    csvLines.push(line.join(','));
  });

  const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM for Excel
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const cleanTitle = tab.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `${cleanTitle}_data.csv`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface DeviceTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  tab: Partial<TabSession>;
}

export const DEVICE_TEMPLATES: DeviceTemplate[] = [
  {
    id: 'clean_poll',
    name: 'Bảng trắng (Clean Master Poll)',
    category: 'Mặc định',
    description: 'Bảng đọc 20 thanh ghi trắng tinh từ địa chỉ 0, không gán sẵn tên biến hay cấu hình riêng.',
    tab: {
      title: 'Phiên Đọc Mới',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 3,
        start_address: 0,
        quantity: 20,
        scan_rate_ms: 1000,
      },
      format: 'unsigned16',
      formats: {},
      aliases: {},
      units: {},
      scalings: {},
      controls: {},
    },
  },
  {
    id: 'vfd_control',
    name: 'Biến tần Modbus (VFD Speed & Run/Stop)',
    category: 'Điều khiển & Động cơ',
    description: 'Mẫu điều khiển biến tần: Lệnh chạy/dừng (Dropdown), cài đặt tần số (Stepper Lên/Xuống), đọc dòng & áp.',
    tab: {
      title: 'Biến tần (VFD Control)',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 3,
        start_address: 2000,
        quantity: 8,
        scan_rate_ms: 500,
      },
      format: 'unsigned16',
      formats: {},
      aliases: {
        2000: 'Lệnh điều khiển (Control Word)',
        2001: 'Tần số đặt (Freq Setpoint)',
        2002: 'Tần số thực tế (Output Freq)',
        2003: 'Dòng điện ngõ ra (Output Current)',
        2004: 'Điện áp DC Bus',
        2005: 'Mã lỗi hiện tại (Fault Code)',
      },
      units: {
        2001: 'Hz',
        2002: 'Hz',
        2003: 'A',
        2004: 'V',
      },
      scalings: {
        2001: 0.1,
        2002: 0.1,
        2003: 0.1,
        2004: 1,
      },
      controls: {
        2000: {
          type: 'dropdown',
          options: [
            { label: '0: Dừng biến tần (STOP)', value: 0 },
            { label: '1: Chạy thuận (RUN FWD)', value: 1 },
            { label: '2: Chạy ngược (RUN REV)', value: 2 },
            { label: '8: Reset lỗi (FAULT RESET)', value: 8 },
          ],
        },
        2001: {
          type: 'stepper',
          step: 10,
          min: 0,
          max: 600,
        },
      },
    },
  },
  {
    id: 'relay_8ch',
    name: 'Bộ Relay Modbus IO 8 kênh (Coils Switch)',
    category: 'Tự động hóa & IO',
    description: 'Mẫu điều khiển 8 Relay ON/OFF độc lập với các nút bấm công tắc tức thời.',
    tab: {
      title: 'Bộ Relay 8 Kênh (Modbus IO)',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 1,
        start_address: 0,
        quantity: 8,
        scan_rate_ms: 500,
      },
      format: 'unsigned16',
      formats: {},
      aliases: {
        0: 'Relay 1 (Đèn chiếu sáng 1)',
        1: 'Relay 2 (Đèn chiếu sáng 2)',
        2: 'Relay 3 (Quạt thông gió 1)',
        3: 'Relay 4 (Quạt thông gió 2)',
        4: 'Relay 5 (Bơm cấp nước)',
        5: 'Relay 6 (Van điện từ cấp)',
        6: 'Relay 7 (Còi báo cháy/sự cố)',
        7: 'Relay 8 (Đèn cảnh báo an toàn)',
      },
      units: {},
      scalings: {},
      controls: {
        0: { type: 'toggle', onValue: 1, offValue: 0 },
        1: { type: 'toggle', onValue: 1, offValue: 0 },
        2: { type: 'toggle', onValue: 1, offValue: 0 },
        3: { type: 'toggle', onValue: 1, offValue: 0 },
        4: { type: 'toggle', onValue: 1, offValue: 0 },
        5: { type: 'toggle', onValue: 1, offValue: 0 },
        6: { type: 'toggle', onValue: 1, offValue: 0 },
        7: { type: 'toggle', onValue: 1, offValue: 0 },
      },
    },
  },
  {
    id: 'water_meter',
    name: 'Đồng hồ đo nước / Lưu lượng BCD',
    category: 'Đo lường & Năng lượng',
    description: 'Mẫu đọc đồng hồ lưu lượng nước hoặc khí nén: Lưu lượng tức thời Float32, tổng thể tích tích lũy 48-bit BCD, áp suất & nhiệt độ.',
    tab: {
      title: 'Đồng hồ nước (Flow Meter)',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 3,
        start_address: 0,
        quantity: 10,
        scan_rate_ms: 1000,
      },
      format: 'unsigned16',
      formats: {
        0: 'float_abcd',
        2: 'water_48_bcd',
        5: 'signed16',
        6: 'signed16',
      },
      aliases: {
        0: 'Lưu lượng tức thời (Flow Rate)',
        1: 'Lưu lượng (Low Word)',
        2: 'Tổng thể tích tích lũy (Total Volume)',
        5: 'Áp lực đường ống (Pressure)',
        6: 'Nhiệt độ nước (Temperature)',
      },
      units: {
        0: 'm3/h',
        2: 'm3',
        5: 'bar',
        6: '°C',
      },
      scalings: {
        0: 1,
        2: 1,
        5: 0.01,
        6: 0.1,
      },
      controls: {},
    },
  },
  {
    id: 'temp_humi',
    name: 'Cảm biến Nhiệt ẩm RS485 (SHT / XY-MD02)',
    category: 'Cảm biến môi trường',
    description: 'Mẫu đọc 2 kênh nhiệt độ và độ ẩm qua Function Code 04 (Read Input Registers).',
    tab: {
      title: 'Cảm biến nhiệt ẩm (SHT)',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 4,
        start_address: 1,
        quantity: 2,
        scan_rate_ms: 1000,
      },
      format: 'signed16',
      formats: {
        1: 'signed16',
        2: 'signed16',
      },
      aliases: {
        1: 'Nhiệt độ môi trường (Temperature)',
        2: 'Độ ẩm không khí (Humidity)',
      },
      units: {
        1: '°C',
        2: '%RH',
      },
      scalings: {
        1: 0.1,
        2: 0.1,
      },
      controls: {},
    },
  },
  {
    id: 'pm2200_power',
    name: 'Đồng hồ điện đa năng PM2200 / Janitza',
    category: 'Đo lường & Năng lượng',
    description: 'Mẫu đo điện 3 pha công nghiệp: Điện áp pha V1N/V2N/V3N, dòng điện, công suất tổng kW, hệ số PF và điện năng kWh.',
    tab: {
      title: 'Đồng hồ điện (PM2200)',
      role: 'master',
      definition: {
        slave_id: 1,
        function_code: 3,
        start_address: 3000,
        quantity: 14,
        scan_rate_ms: 1000,
      },
      format: 'unsigned16',
      formats: {
        3000: 'float_abcd',
        3002: 'float_abcd',
        3004: 'float_abcd',
        3006: 'float_abcd',
        3008: 'float_abcd',
        3010: 'float_abcd',
        3012: 'float_abcd',
      },
      aliases: {
        3000: 'Điện áp Pha A (V1N)',
        3002: 'Điện áp Pha B (V2N)',
        3004: 'Điện áp Pha C (V3N)',
        3006: 'Dòng điện Pha A (I1)',
        3008: 'Công suất tác dụng tổng (Total P)',
        3010: 'Hệ số công suất trung bình (PF)',
        3012: 'Tổng điện năng tích lũy (Total kWh)',
      },
      units: {
        3000: 'V',
        3002: 'V',
        3004: 'V',
        3006: 'A',
        3008: 'kW',
        3010: '-',
        3012: 'kWh',
      },
      scalings: {
        3000: 1,
        3002: 1,
        3004: 1,
        3006: 1,
        3008: 1,
        3010: 1,
        3012: 1,
      },
      controls: {},
    },
  },
];

export interface DeviceProfileData {
  app: string;
  type: 'device_profile';
  version: string;
  profileName: string;
  exportedAt: string;
  tab: {
    title: string;
    role: SessionRole;
    definition: PollDefinition;
    format: DataFormat;
    formats: Record<number, DataFormat>;
    aliases: Record<number, string>;
    units: Record<number, string>;
    scalings: Record<number, number>;
    controls: Record<number, RegisterControlConfig>;
  };
}

/**
 * Exports current sheet configuration as a shareable standalone Device Profile JSON file.
 */
export function exportDeviceProfileToFile(tab: TabSession, profileName?: string): void {
  const name = profileName || tab.title || 'Device_Profile';
  const payload: DeviceProfileData = {
    app: 'NXChieu-Modbus-Tool',
    type: 'device_profile',
    version: '1.0',
    profileName: name,
    exportedAt: new Date().toISOString(),
    tab: {
      title: tab.title,
      role: tab.role,
      definition: tab.definition,
      format: tab.format,
      formats: tab.formats || {},
      aliases: tab.aliases || {},
      units: tab.units || {},
      scalings: tab.scalings || {},
      controls: tab.controls || {},
    },
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const cleanName = name.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `${cleanName}.profile.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseDeviceProfileJson(content: string): Partial<TabSession> {
  const data = JSON.parse(content);
  const rawTab =
    data.type === 'device_profile' && data.tab
      ? data.tab
      : data.tabs
      ? data.tabs[0]
      : data.polling_tabs
      ? data.polling_tabs[0]
      : data;
  if (!rawTab) throw new Error('File không chứa cấu hình thiết bị hợp lệ.');

  const normalized = normalizeTab(rawTab, 0, new Set());
  if (normalized) return normalized;

  return {
    title: rawTab.title || rawTab.name || data.profileName || data.profile_name || 'Imported Device',
    role: rawTab.role === 'slave' ? 'slave' : 'master',
    definition: rawTab.definition,
    format: rawTab.format || 'unsigned16',
    formats: rawTab.formats || {},
    aliases: rawTab.aliases || {},
    units: rawTab.units || {},
    scalings: rawTab.scalings || {},
    controls: rawTab.controls || {},
  };
}

export function importDeviceProfileFromFile(file: File): Promise<Partial<TabSession>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        resolve(parseDeviceProfileJson(content));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Lỗi khi đọc file Profile.'));
    reader.readAsText(file);
  });
}
