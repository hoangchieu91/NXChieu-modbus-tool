import { TabSession, RegisterRow } from '../types/modbus';

const STORAGE_KEY = 'nxchieu_modbus_workspace_v1';

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
// Integer in [min, max]; fractions (e.g. Slave ID 1.5) cannot be passed to the Go uint APIs.
const int = (v: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(num(v, fallback))));

/**
 * Fills missing or malformed fields of a saved/imported tab with defaults. A corrupted file
 * would otherwise crash rendering, and since the workspace is auto-saved it would crash again
 * on every launch.
 */
function normalizeTab(raw: unknown, index: number, usedIds: Set<string>): TabSession | null {
  if (!isRecord(raw)) return null;

  let id = typeof raw.id === 'string' && raw.id ? raw.id : `tab-${Date.now()}-${index}`;
  if (usedIds.has(id)) id = `${id}-${index}`;
  usedIds.add(id);

  const def = isRecord(raw.definition) ? raw.definition : {};
  const fc = num(def.function_code, 3);
  const startAddr = int(def.start_address, 0, 0, 65535);
  const slaveStart = int(raw.slaveStartAddr, 0, 0, 65535);

  return {
    ...(raw as Partial<TabSession>),
    id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : `Sheet ${index + 1}`,
    role: raw.role === 'slave' ? 'slave' : 'master',
    definition: {
      slave_id: int(def.slave_id, 1, 1, 247),
      function_code: [1, 2, 3, 4].includes(fc) ? fc : 3,
      start_address: startAddr,
      // The read range must end at or before address 65535.
      quantity: Math.min(int(def.quantity, 10, 1, 125), 65536 - startAddr),
      scan_rate_ms: int(def.scan_rate_ms, 1000, 50, 3600000),
    },
    format: typeof raw.format === 'string' ? raw.format : 'unsigned16',
    formats: isRecord(raw.formats) ? raw.formats : {},
    aliases: isRecord(raw.aliases) ? raw.aliases : {},
    units: isRecord(raw.units) ? raw.units : {},
    scalings: isRecord(raw.scalings) ? raw.scalings : {},
    slaveConfig: isRecord(raw.slaveConfig) ? (raw.slaveConfig as TabSession['slaveConfig']) : undefined,
    slaveTable: ['holding', 'coils', 'discrete', 'input'].includes(raw.slaveTable) ? raw.slaveTable : 'holding',
    slaveStartAddr: slaveStart,
    // Go takes the quantity as uint16, and the view must not run past address 65535.
    slaveQuantity: Math.min(int(raw.slaveQuantity, 10, 1, 65535), 65536 - slaveStart),
    // Servers and simulations never survive a restart or an import.
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
  const tabs = normalizeTabs(data?.tabs);
  if (tabs.length === 0) {
    throw new Error('File không đúng định dạng cấu hình dự án Modbus (thiếu danh sách tabs).');
  }
  return {
    tabs,
    activeTabId: pickActiveTabId(tabs, data.activeTabId),
    projectName: data.projectName || fallbackName,
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
