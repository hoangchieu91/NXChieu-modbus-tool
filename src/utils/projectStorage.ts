import { TabSession, RegisterRow } from '../types/modbus';

const STORAGE_KEY = 'nxchieu_modbus_workspace_v1';

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
    const data: ProjectData = JSON.parse(raw);
    if (data && Array.isArray(data.tabs) && data.tabs.length > 0) {
      return {
        tabs: data.tabs,
        activeTabId: data.activeTabId || data.tabs[0].id,
      };
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

/**
 * Parses an uploaded .nxmodbus or .json file and reconstructs the sheets.
 */
export function importProjectFromFile(file: File): Promise<{ tabs: TabSession[]; activeTabId: string; projectName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) {
          throw new Error('File không đúng định dạng cấu hình dự án Modbus (thiếu danh sách tabs).');
        }

        resolve({
          tabs: data.tabs,
          activeTabId: data.activeTabId || data.tabs[0].id,
          projectName: data.projectName || file.name.replace(/\.[^/.]+$/, ''),
        });
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
