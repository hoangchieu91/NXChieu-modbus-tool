import React, { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  listSerialPorts,
  sessionConnect,
  sessionDisconnect,
  sessionStartPolling,
  sessionStopPolling,
  sessionReadOnce,
  sessionWriteRegister,
  sessionWriteRegisters,
  sessionWriteCoil,
  closeSession,
  slaveStart,
  slaveStop,
  slaveGetSlice,
  slaveSetRegister,
  slaveSetCoil,
  slaveStartSim,
  slaveStopSim,
  subscribePollData,
  subscribeSlaveActivity,
  subscribeRemoteWrite,
  sessionResetCounters,
  scanRegisters,
  scanSlaveIDs,
  autoDetectBaudrate,
  completeRemoteWrite,
  getDiagnosticSnifferSnapshot,
  updateRemoteServerState,
} from './services/backend';

import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { TabBar } from './components/TabBar';
import { DataGrid } from './components/DataGrid';
import { TrafficBox } from './components/TrafficBox';
import { StatusBar } from './components/StatusBar';
import { ConnectionModal } from './components/ConnectionModal';
import { DefinitionModal } from './components/DefinitionModal';
import { WriteModal } from './components/WriteModal';
import { SlaveModal } from './components/SlaveModal';
import { TrendChart } from './components/TrendChart';
import { HelpModal } from './components/HelpModal';
import { ScannerModal } from './components/ScannerModal';
import { ActionNotice, ActionNoticeState } from './components/ActionNotice';
import { QuickInspector } from './components/QuickInspector';
import { DiagnosticCheck, StudioDiagnostics } from './components/StudioDiagnostics';
import { ErrorBoundary } from './components/ErrorBoundary';
const FRONTEND_MODE_KEY = 'nxchieu-frontend-mode';
const WorkspaceStudio = lazy(() => import('./components/WorkspaceStudio').then((module) => ({ default: module.WorkspaceStudio })));
const ProtocolAnalyzer = lazy(() => import('./components/ProtocolAnalyzer').then((module) => ({ default: module.ProtocolAnalyzer })));
const AnalyzerStudio = lazy(() => import('./components/AnalyzerStudio').then((module) => ({ default: module.AnalyzerStudio })));
const MobileRemoteModal = lazy(() => import('./components/MobileRemoteModal').then((module) => ({ default: module.MobileRemoteModal })));


import {
  ChartDataPoint,
  ChartTrace,
  ConnectionConfig,
  DataFormat,
  PollResult,
  PollDefinition,
  RegisterRow,
  SerialPortDetail,
  SessionRole,
  SimulationConfig,
  SlaveConfig,
  SlaveTable,
  TabSession,
  TrafficEntry,
} from './types/modbus';
import {
  formatValue,
  getModbusAddressLabel,
  decodeAllColumns,
  encodeRegisterInput,
  modiconAddress,
  modiconTableDigit,
} from './utils/formatters';

import {
  loadWorkspace,
  saveWorkspace,
  exportProjectToFile,
  importProjectFromFile,
  exportSheetToCSV,
} from './utils/projectStorage';

// HH:MM:SS.mmm shown in the grid, traffic log and chart.
const clockStamp = (d: Date) => d.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');

// Whether a tab shows bit values (coils / discrete inputs) rather than registers.
const isCoilTab = (tab: TabSession) =>
  tab.role === 'slave'
    ? tab.slaveTable === 'coils' || tab.slaveTable === 'discrete'
    : tab.definition.function_code === 1 || tab.definition.function_code === 2;

// FC02 (Discrete Inputs) and FC04 (Input Registers) are read-only tables on a Modbus device.
const isReadOnlyFunction = (fc: number) => fc === 2 || fc === 4;

// Numeric value plotted on the trend chart. Text formats (hex/bin/ascii) do not parse as numbers,
// so they fall back to the scaled raw register instead of a flat 0.
const toChartValue = (values: number[], idx: number, fmt: DataFormat, scaling: number): number => {
  if (fmt === 'hex16' || fmt === 'bin16' || fmt === 'ascii') return values[idx] * scaling;
  const display = formatValue(values, idx, fmt, scaling).display;
  if (display === '--') return NaN; // value spans registers outside the read block
  const parsed = parseFloat(display.replace(/,/g, ''));
  return isNaN(parsed) ? values[idx] * scaling : parsed;
};

// --- Grid Row Construction Helper ---

// Pure function of the tab config and its live state; memoized by callers so rows (and the
// multi-column decodes) are rebuilt only when data changes, not on every App render.

function buildRowsForTab(tab: TabSession, state: PerTabState): { rows: RegisterRow[]; isCoil: boolean } {
  const isCoil = isCoilTab(tab);

  const startAddr = tab.role === 'slave' ? tab.slaveStartAddr : tab.definition.start_address;
  const quantity = tab.role === 'slave' ? tab.slaveQuantity : tab.definition.quantity;

  const resultRows: RegisterRow[] = [];
  for (let i = 0; i < quantity; i++) {
    const addr = startAddr + i;
    const alias = tab.aliases[addr] || '';
    const unit = tab.units[addr] || '';
    const scaling = tab.scalings[addr] ?? 1;
    const rowFormat = tab.formats?.[addr];

    let rawVal: number | boolean | null = null;
    let displayVal = '--';
    let rawHex = '--';
    let changed = false;
    let changeDirection: 'up' | 'down' | null = null;
    let decodedMulti: import('./types/modbus').MultiColumnDecoded | undefined = undefined;

    const hasData = tab.role === 'slave' ? true : state.hasData;
    let cellHasValue = false;

    if (hasData) {
      if (isCoil) {
        if (i < state.coils.length) {
          const bit = state.coils[i];
          const prevBit = (state.lastValues[i] as boolean) ?? bit;
          rawVal = bit;
          displayVal = bit ? 'ON' : 'OFF';
          rawHex = bit ? '0x01' : '0x00';
          changed = bit !== prevBit;
          if (changed) {
            changeDirection = bit ? 'up' : 'down';
          }
          cellHasValue = true;
        }
      } else {
        if (i < state.regs.length) {
          const v = state.regs[i];
          const prevV = (state.lastValues[i] as number) ?? v;
          rawVal = v;
          const effectiveFmt = rowFormat || tab.format;
          const fmtRes = formatValue(state.regs, i, effectiveFmt, scaling);
          displayVal = fmtRes.display;
          rawHex = fmtRes.hex;
          changed = v !== prevV;
          if (changed) {
            changeDirection = v > prevV ? 'up' : 'down';
          }
          cellHasValue = true;
          decodedMulti = decodeAllColumns(state.regs, i, addr, tab.definition.function_code);
        }
      }
    }

    let displayAddress = '';
    if (tab.role === 'slave') {
      displayAddress = `${modiconAddress(modiconTableDigit(tab.slaveTable), addr)} (${addr})`;
    } else {
      displayAddress = getModbusAddressLabel(tab.definition.function_code, addr);
    }

    const lastUpdated = state.lastUpdatedMap?.[addr] || (cellHasValue ? state.lastUpdatedTime : undefined);

    resultRows.push({
      address: addr,
      displayAddress,
      alias,
      rawValue: rawVal,
      displayValue: displayVal,
      rawHex,
      unit,
      scaling,
      format: rowFormat,
      lastUpdated,
      changed,
      changeDirection,
      hasValue: cellHasValue,
      decodedMulti,
    });
  }


  return { rows: resultRows, isCoil };
}

type TracePoint = { timestamp: string; timeMs: number; value: number };

// Value a trace samples from a read result: a register (decoded with its format) or a coil as 0/1.
const sampleTrace = (values: number[], bools: boolean[], idx: number, fmt: DataFormat, scaling: number): number => {
  if (values.length === 0 && bools.length > 0) {
    return idx >= 0 && idx < bools.length ? (bools[idx] ? 1 : 0) : NaN;
  }
  return idx >= 0 && idx < values.length ? toChartValue(values, idx, fmt, scaling) : NaN;
};

// Appends one point per trace in a single state update, keeping the last 300 points.
const appendTracePoints = (prev: Record<string, TracePoint[]>, points: Record<string, TracePoint>) => {
  const next = { ...prev };
  for (const [id, point] of Object.entries(points)) {
    next[id] = [...(prev[id] || []).slice(-299), point];
  }
  return next;
};

const DEFAULT_DEFINITION: PollDefinition = {
  slave_id: 1,
  function_code: 3, // Read Holding Registers
  start_address: 0,
  quantity: 10,
  scan_rate_ms: 1000,
};

const DEFAULT_SLAVE_CONFIG: SlaveConfig = {
  type: 'tcp',
  host: '0.0.0.0',
  port_tcp: 5020,
  slave_id: 1,
};

interface PerTabState {
  isConnected: boolean;
  isPolling: boolean;
  connectionConfig: ConnectionConfig | null;
  txCount: number;
  errCount: number;
  latencyMs: number;
  traffic: TrafficEntry[];
  hasData: boolean;
  regs: number[];
  coils: boolean[];
  lastValues: (number | boolean)[];
  slaveActivityCount: number;
  isListening: boolean;
  isSimulating: boolean;
  lastUpdatedMap: Record<number, string>;
  lastUpdatedTime?: string;
}

const INITIAL_TAB: TabSession = {
  id: 'tab-1',
  title: 'Sheet 1',
  role: 'master',
  definition: DEFAULT_DEFINITION,
  format: 'unsigned16',
  aliases: {
    0: 'Điện áp pha A (Ua)',
    1: 'Dòng điện pha A (Ia)',
    2: 'Công suất tác dụng (P)',
    3: 'Hệ số công suất (PF)',
    4: 'Tần số lưới (Freq)',
    5: 'Nhiệt độ cuộn dây',
    6: 'Trạng thái cảnh báo',
  },
  units: {
    0: 'V',
    1: 'A',
    2: 'W',
    3: '',
    4: 'Hz',
    5: '°C',
    6: '',
  },
  scalings: {
    0: 0.1,
    1: 0.01,
    2: 1,
    3: 0.01,
    4: 0.01,
    5: 1,
    6: 1,
  },
  slaveConfig: DEFAULT_SLAVE_CONFIG,
  slaveTable: 'holding',
  slaveStartAddr: 0,
  slaveQuantity: 10,
};

const createEmptyTabState = (): PerTabState => ({
  isConnected: false,
  isPolling: false,
  connectionConfig: null,
  txCount: 0,
  errCount: 0,
  latencyMs: 0,
  traffic: [],
  hasData: false,
  regs: [],
  coils: [],
  lastValues: [],
  slaveActivityCount: 0,
  isListening: false,
  isSimulating: false,
  lastUpdatedMap: {},
});

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<TabSession[]>(() => {
    const saved = loadWorkspace();
    return saved && saved.tabs && saved.tabs.length > 0 ? saved.tabs : [INITIAL_TAB];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const saved = loadWorkspace();
    return saved ? saved.activeTabId : 'tab-1';
  });
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-session independent runtime states
  const [tabStates, setTabStates] = useState<Record<string, PerTabState>>({
    'tab-1': createEmptyTabState(),
  });

  // UI display toggles
  const [showTraffic, setShowTraffic] = useState<boolean>(true);
  const [isProtocolAnalyzerOpen, setIsProtocolAnalyzerOpen] = useState<boolean>(false);
  const [isAnalyzerStudioOpen, setIsAnalyzerStudioOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<ActionNoticeState | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((tone: ActionNoticeState['tone'], message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setActionNotice({ id: Date.now(), tone, message });
    noticeTimerRef.current = setTimeout(() => setActionNotice(null), tone === 'error' ? 7000 : 4000);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);
  const [frontendMode, setFrontendMode] = useState<'classic' | 'studio'>(() => {
    try {
      return localStorage.getItem(FRONTEND_MODE_KEY) === 'studio' ? 'studio' : 'classic';
    } catch {
      return 'classic';
    }
  });
  const [isSplitView, setIsSplitView] = useState<boolean>(false);
  const [splitTabId, setSplitTabId] = useState<string>('');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(FRONTEND_MODE_KEY, frontendMode);
    } catch {
      // storage unavailable: the mode just is not remembered
    }
  }, [frontendMode]);

  // Multi-trace Realtime Trend Chart State
  const [chartTraces, setChartTraces] = useState<ChartTrace[]>([]);
  const [traceData, setTraceData] = useState<Record<string, ChartDataPoint[]>>({});
  const [isChartVisible, setIsChartVisible] = useState<boolean>(false);

  // Quick Inspector Panel State
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [selectedRowAddress, setSelectedRowAddress] = useState<number | null>(null);

  const TRACE_PALETTE = useMemo(
    () => ['#22d3ee', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#38bdf8', '#eab308', '#ec4899'],
    []
  );

  // Handlers for hotkeys that are defined further down; assigned on every render.
  const hotkeyActionsRef = useRef<{ connectToggle: () => void; readOnce: () => void; definition: () => void } | null>(null);
  // Device actions (F3 connect/disconnect, F7 read, F8 definition) are ignored while a
  // full-screen analyzer or diagnostics view hides the workspace they act on.
  const overlayOpenRef = useRef(false);

  // Global Hotkeys: F1 (Help), F3 (Connect/Disconnect), F4 (Scanner), F7 (Read Once),
  // F8 (Definition), F9 (Mobile Remote)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actions = overlayOpenRef.current ? null : hotkeyActionsRef.current;
      if (['F3', 'F7', 'F8'].includes(e.key) && !actions) {
        e.preventDefault();
      } else if (e.key === 'F3' && actions) {
        e.preventDefault();
        actions.connectToggle();
      } else if (e.key === 'F7' && actions) {
        e.preventDefault();
        actions.readOnce();
      } else if (e.key === 'F8' && actions) {
        e.preventDefault();
        actions.definition();
      } else if (e.key === 'F1') {
        e.preventDefault();
        setIsHelpModalOpen((prev) => !prev);
      } else if (e.key === 'F4') {
        e.preventDefault();
        setIsScannerModalOpen((prev) => !prev);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setIsMobileModalOpen((prev) => !prev);
      } else if (e.key === 'F10') {
        // Only one analyzer at a time: each polls thousands of frames.
        e.preventDefault();
        setIsAnalyzerStudioOpen(false);
        setIsProtocolAnalyzerOpen((prev) => !prev);
      } else if (e.key === 'F11') {
        e.preventDefault();
        setIsProtocolAnalyzerOpen(false);
        setIsAnalyzerStudioOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-save workspace on tabs or active tab change
  useEffect(() => {
    saveWorkspace(tabs, activeTabId);
  }, [tabs, activeTabId]);

  // Modals state
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState<boolean>(false);
  const [isDefinitionModalOpen, setIsDefinitionModalOpen] = useState<boolean>(false);
  const [isWriteModalOpen, setIsWriteModalOpen] = useState<boolean>(false);
  const [isSlaveModalOpen, setIsSlaveModalOpen] = useState<boolean>(false);
  const [isScannerModalOpen, setIsScannerModalOpen] = useState<boolean>(false);
  const [isMobileModalOpen, setIsMobileModalOpen] = useState<boolean>(false);
  const [selectedRowForWrite, setSelectedRowForWrite] = useState<RegisterRow | null>(null);
  const [selectedTabForWrite, setSelectedTabForWrite] = useState<TabSession | null>(null);


  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const activeState = tabStates[activeTab.id] || createEmptyTabState();

  const activeTabRef = useRef<TabSession>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const tabsRef = useRef<TabSession[]>(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const chartTracesRef = useRef<ChartTrace[]>(chartTraces);
  useEffect(() => {
    chartTracesRef.current = chartTraces;
  }, [chartTraces]);

  // Fetch available COM ports
  const refreshPorts = useCallback(async () => {
    try {
      const ports = await listSerialPorts();
      setAvailablePorts(ports);
    } catch (e) {
      console.warn('Could not list serial ports:', e);
    }
  }, []);

  useEffect(() => {
    refreshPorts();
  }, [refreshPorts]);

  // Helper to update state for a specific tab
  const updateTabState = useCallback((tabId: string, updater: (prev: PerTabState) => PerTabState) => {
    setTabStates((prev) => {
      const current = prev[tabId] || createEmptyTabState();
      return { ...prev, [tabId]: updater(current) };
    });
  }, []);

  // Fetch Memory Slice for Slave Mode
  const refreshSlaveSlice = useCallback(
    async (tabId: string, table: SlaveTable, startAddr: number, qty: number) => {
      try {
        // Only slave tabs show slave memory; a late refresh must not overwrite a master grid.
        const tabNow = tabsRef.current.find((t) => t.id === tabId);
        if (tabNow && tabNow.role !== 'slave') return;
        const slice = await slaveGetSlice(tabId, table, startAddr, qty);
        if (tabsRef.current.find((t) => t.id === tabId)?.role === 'master') return;
        const now = new Date();
        const timeStr = clockStamp(now);

        updateTabState(tabId, (prev) => {
          const updatedMap = { ...(prev.lastUpdatedMap || {}) };
          const count = slice.values?.length || slice.bool_values?.length || 0;
          for (let i = 0; i < count; i++) {
            updatedMap[startAddr + i] = timeStr;
          }

          const isBitTable = (slice.bool_values?.length ?? 0) > 0;
          return {
            ...prev,
            hasData: true,
            regs: slice.values || [],
            coils: slice.bool_values || [],
            // Previous values drive the up/down change highlight.
            lastValues: isBitTable ? prev.coils : prev.regs,
            lastUpdatedTime: timeStr,
            lastUpdatedMap: updatedMap,
          };
        });

        // Record point for any chart trace matching this tab
        if (chartTracesRef.current.length > 0) {
          const targetTab = tabsRef.current.find((t) => t.id === tabId) || activeTabRef.current;
          const points: Record<string, TracePoint> = {};
          chartTracesRef.current.forEach((trace) => {
            if (trace.tabId === tabId) {
              const regFmt = targetTab.formats?.[trace.address] || targetTab.format;
              const scaling = targetTab.scalings?.[trace.address] ?? 1;
              const value = sampleTrace(slice.values || [], slice.bool_values || [], trace.address - startAddr, regFmt, scaling);
              if (Number.isFinite(value)) {
                points[trace.id] = { timestamp: timeStr, timeMs: now.getTime(), value };
              }
            }
          });
          if (Object.keys(points).length > 0) {
            setTraceData((prev) => appendTracePoints(prev, points));
          }
        }
      } catch (err) {
        console.error('Failed to load slave memory slice:', err);
      }
    },
    [updateTabState]
  );

  // Load slave slice on mount or when switching to slave mode
  useEffect(() => {
    if (activeTab.role === 'slave') {
      refreshSlaveSlice(activeTab.id, activeTab.slaveTable, activeTab.slaveStartAddr, activeTab.slaveQuantity);
    }
  }, [activeTab.id, activeTab.role, activeTab.slaveTable, activeTab.slaveStartAddr, activeTab.slaveQuantity, refreshSlaveSlice]);

  // Applies a master read result (polling event or Read Once) to a tab: values, counters,
  // traffic log, per-row timestamps and chart traces.
  const applyPollResult = useCallback(
    (targetId: string, payload: PollResult) => {
      const resultTab = tabsRef.current.find((t) => t.id === targetId);
      // Drop results that no longer match the tab: the tab switched to Slave mode, or the
      // definition changed while this request was in flight.
      if (resultTab) {
        const def = resultTab.definition;
        if (
          resultTab.role !== 'master' ||
          (payload.slave_id !== undefined && payload.slave_id !== def.slave_id) ||
          (payload.function_code !== undefined && payload.function_code !== def.function_code) ||
          (payload.start_address !== undefined && payload.start_address !== def.start_address)
        ) {
          return;
        }
      }

      const now = new Date();
      const timeStr = clockStamp(now);

      updateTabState(targetId, (prev) => {
        const newEntries: TrafficEntry[] = [];
        if (payload.raw_tx) {
          newEntries.push({
            id: `tx-${Date.now()}-${Math.random()}`,
            timestamp: payload.timestamp,
            direction: 'tx',
            hex: payload.raw_tx,
          });
        }
        // Failed reads carry no raw_rx, so the error needs its own entry to be visible.
        if (payload.error) {
          newEntries.push({
            id: `err-${Date.now()}-${Math.random()}`,
            timestamp: payload.timestamp,
            direction: 'err',
            hex: `Error: ${payload.error}`,
          });
        } else if (payload.raw_rx) {
          newEntries.push({
            id: `rx-${Date.now()}-${Math.random()}`,
            timestamp: payload.timestamp,
            direction: 'rx',
            hex: payload.raw_rx,
          });
        }

        const isSuccess = !payload.error && (payload.values.length > 0 || payload.bool_values.length > 0);
        const updatedMap = { ...(prev.lastUpdatedMap || {}) };
        if (isSuccess) {
          const targetTab = tabsRef.current.find((t) => t.id === targetId) || activeTabRef.current;
          const start = payload.start_address ?? targetTab.definition.start_address;
          const count = payload.values.length || payload.bool_values.length;
          for (let i = 0; i < count; i++) {
            updatedMap[start + i] = timeStr;
          }
        }

        return {
          ...prev,
          txCount: payload.tx_count,
          errCount: payload.err_count,
          latencyMs: payload.latency_ms,
          // A failed poll keeps the last good values on screen (errors show in the traffic log),
          // so the grid does not blank out and change detection keeps working.
          hasData: isSuccess || prev.hasData,
          regs: isSuccess ? payload.values : prev.regs,
          coils: isSuccess ? payload.bool_values : prev.coils,
          lastValues: isSuccess ? (payload.is_coil ? prev.coils : prev.regs) : prev.lastValues,
          lastUpdatedTime: isSuccess ? timeStr : prev.lastUpdatedTime,
          lastUpdatedMap: updatedMap,
          traffic: [...prev.traffic, ...newEntries].slice(-500),
        };
      });

      // Record point for any chart trace matching this tab
      const isSuccess = !payload.error && (payload.values.length > 0 || payload.bool_values.length > 0);
      if (isSuccess && chartTracesRef.current.length > 0) {
        const targetTab = tabsRef.current.find((t) => t.id === targetId) || activeTabRef.current;
        const start = payload.start_address ?? targetTab.definition.start_address;
        const points: Record<string, TracePoint> = {};

        chartTracesRef.current.forEach((trace) => {
          if (trace.tabId === targetId) {
            const regFmt = targetTab.formats?.[trace.address] || targetTab.format;
            const scaling = targetTab.scalings?.[trace.address] ?? 1;
            const value = sampleTrace(payload.values, payload.bool_values, trace.address - start, regFmt, scaling);
            if (Number.isFinite(value)) {
              points[trace.id] = { timestamp: timeStr, timeMs: now.getTime(), value };
            }
          }
        });
        if (Object.keys(points).length > 0) {
          setTraceData((prev) => appendTracePoints(prev, points));
        }
      }
    },
    [updateTabState]
  );

  // Subscribe to Master Poll-Data Events
  useEffect(() => {
    const unbind = subscribePollData((payload) => {
      applyPollResult(payload.session_id || activeTabRef.current.id, payload);
    });

    return () => unbind();
  }, [applyPollResult]);

  // The slave simulation writes memory without activity events, so simulating slave tabs are
  // refreshed on a timer; otherwise their grids would stay frozen.
  const simulatingTabIds = tabs
    .filter((t) => t.role === 'slave' && tabStates[t.id]?.isSimulating)
    .map((t) => t.id)
    .join(',');
  useEffect(() => {
    if (!simulatingTabIds) return;
    const ids = simulatingTabIds.split(',');
    const timer = setInterval(() => {
      for (const id of ids) {
        const tab = tabsRef.current.find((t) => t.id === id);
        if (tab) refreshSlaveSlice(tab.id, tab.slaveTable, tab.slaveStartAddr, tab.slaveQuantity);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [simulatingTabIds, refreshSlaveSlice]);

  // Subscribe to Slave Activity Events (Master reading/writing into our Slave server)
  useEffect(() => {
    const unbind = subscribeSlaveActivity((act) => {
      const targetId = act.session_id || activeTabRef.current.id;

      updateTabState(targetId, (prev) => {
        const newEntry: TrafficEntry = {
          id: `slv-${Date.now()}-${Math.random()}`,
          timestamp: act.timestamp,
          direction: act.is_write ? 'rx' : 'tx',
          description: `${act.client} -> ${act.summary}`,
          hex: act.hex_raw || act.summary,
        };

        return {
          ...prev,
          slaveActivityCount: prev.slaveActivityCount + 1,
          traffic: [...prev.traffic, newEntry].slice(-500),
        };
      });

      // Synchronize memory table with latest changes (coalesced, see scheduleSlaveRefresh).
      // Every tab with events is refreshed, so a slave shown in the split pane updates too.
      dirtyTabs.add(targetId);
      scheduleSlaveRefresh();
    });

    // A fast external master can generate hundreds of events per second. Refresh at most every
    // 100ms with a single request in flight, so responses cannot arrive out of order.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;
    const dirtyTabs = new Set<string>();
    const runRefresh = async () => {
      timer = null;
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      const ids = [...dirtyTabs];
      dirtyTabs.clear();
      try {
        for (const id of ids) {
          const tab = tabsRef.current.find((t) => t.id === id);
          if (tab?.role === 'slave') {
            await refreshSlaveSlice(tab.id, tab.slaveTable, tab.slaveStartAddr, tab.slaveQuantity);
          }
        }
      } finally {
        inFlight = false;
        if (pending) {
          pending = false;
          scheduleSlaveRefresh();
        }
      }
    };
    function scheduleSlaveRefresh() {
      if (!timer) timer = setTimeout(runRefresh, 100);
    }

    return () => {
      unbind();
      if (timer) clearTimeout(timer);
    };
  }, [updateTabState, refreshSlaveSlice]);

  // --- Master Connection Handlers ---

  const handleConnect = async (cfg: ConnectionConfig): Promise<boolean> => {
    try {
      await sessionConnect(activeTab.id, cfg);
      updateTabState(activeTab.id, (prev) => ({
        ...prev,
        isConnected: true,
        connectionConfig: cfg,
        hasData: false,
        regs: [],
        coils: [],
        lastValues: [],
        txCount: 0,
        errCount: 0,
        latencyMs: 0,
      }));
      notify('success', cfg.type === 'serial' && cfg.port === 'simulator' ? 'Đã kết nối simulator nội bộ.' : 'Kết nối Modbus thành công.');
      return true;
    } catch (err) {
      // The backend closes the previous link before opening the new one, and its poll loop
      // stops once disconnected, so the tab is no longer connected nor polling.
      updateTabState(activeTab.id, (prev) => ({ ...prev, isConnected: false, isPolling: false }));
      notify('error', `Kết nối thất bại: ${err}`);
      return false;
    }
  };

  const handleDisconnect = async () => {
    try {
      await sessionDisconnect(activeTab.id);
      updateTabState(activeTab.id, (prev) => ({
        ...prev,
        isConnected: false,
        isPolling: false,
        hasData: false,
        regs: [],
        coils: [],
        lastValues: [],
      }));
      notify('info', 'Đã ngắt kết nối.');
    } catch (err) {
      console.error(err);
    }
  };

  const handleTogglePoll = async () => {
    if (!activeState.isConnected) return;
    try {
      if (activeState.isPolling) {
        await sessionStopPolling(activeTab.id);
        updateTabState(activeTab.id, (prev) => ({ ...prev, isPolling: false }));
        notify('info', 'Đã tạm dừng polling.');
      } else {
        await sessionStartPolling(activeTab.id, activeTab.definition);
        updateTabState(activeTab.id, (prev) => ({ ...prev, isPolling: true }));
        notify('success', 'Polling đã bắt đầu.');
      }
    } catch (err) {
      notify('error', `Lỗi Polling: ${err}`);
    }
  };

  const handleReadOnce = async () => {
    if (!activeState.isConnected || activeState.isPolling) return;
    try {
      const res = await sessionReadOnce(activeTab.id, activeTab.definition);
      applyPollResult(activeTab.id, res);
      if (res.error) {
        notify('error', `Đọc thất bại: ${res.error}`);
      } else {
        notify('success', `Đã đọc ${res.values.length || res.bool_values.length} điểm dữ liệu.`);
      }
    } catch (err) {
      notify('error', `Lỗi đọc: ${err}`);
    }
  };

  // --- Slave Handlers ---

  const handleStartSlaveServer = async (cfg: SlaveConfig): Promise<boolean> => {
    try {
      await slaveStart(activeTab.id, cfg);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, slaveConfig: cfg, isListening: true } : t))
      );
      updateTabState(activeTab.id, (prev) => ({
        ...prev,
        isListening: true,
      }));
      await refreshSlaveSlice(activeTab.id, activeTab.slaveTable, activeTab.slaveStartAddr, activeTab.slaveQuantity);
      notify('success', 'Slave server đã bắt đầu lắng nghe.');
      return true;
    } catch (err) {
      notify('error', `Khởi động Slave Server thất bại: ${err}`);
      return false;
    }
  };

  const handleStopSlaveServer = async () => {
    try {
      await slaveStop(activeTab.id);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, isListening: false } : t))
      );
      updateTabState(activeTab.id, (prev) => ({
        ...prev,
        isListening: false,
        isSimulating: false,
      }));
      notify('info', 'Slave server đã dừng.');
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleSlaveServer = async () => {
    if (activeState.isListening) {
      await handleStopSlaveServer();
    } else {
      await handleStartSlaveServer(activeTab.slaveConfig || DEFAULT_SLAVE_CONFIG);
    }
  };

  const handleStartSimulation = async (simCfg: SimulationConfig) => {
    try {
      simCfg.session_id = activeTab.id;
      await slaveStartSim(activeTab.id, simCfg);
      updateTabState(activeTab.id, (prev) => ({ ...prev, isSimulating: true }));
      notify('success', 'Mô phỏng dữ liệu Slave đã bắt đầu.');
    } catch (err) {
      notify('error', `Lỗi kích hoạt mô phỏng: ${err}`);
    }
  };

  const handleStopSimulation = async () => {
    try {
      await slaveStopSim(activeTab.id);
      updateTabState(activeTab.id, (prev) => ({ ...prev, isSimulating: false }));
      notify('info', 'Mô phỏng dữ liệu Slave đã dừng.');
    } catch (err) {
      console.error(err);
    }
  };

  // Switch role between Master & Slave
  const handleRoleChange = async (role: SessionRole) => {
    if (role === activeTab.role) return;
    const tabId = activeTab.id;
    const state = tabStates[tabId];

    // Stop whatever the previous role was doing, so it does not keep a COM port / socket open
    // or keep emitting events in the background.
    try {
      if (role === 'slave') {
        if (state?.isPolling) await sessionStopPolling(tabId);
        if (state?.isConnected) await sessionDisconnect(tabId);
      } else if (state?.isListening || state?.isSimulating || activeTab.isListening) {
        await slaveStop(tabId); // also stops the simulation
      }
    } catch (err) {
      console.error('Lỗi dừng chế độ cũ khi đổi vai trò:', err);
    }

    updateTabState(tabId, (prev) => ({
      ...prev,
      isPolling: false,
      isConnected: false,
      isListening: false,
      isSimulating: false,
      hasData: false,
      regs: [],
      coils: [],
      lastValues: [],
    }));
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, role, isListening: false, isSimulating: false } : t))
    );
    if (role === 'slave') {
      refreshSlaveSlice(activeTab.id, activeTab.slaveTable, activeTab.slaveStartAddr, activeTab.slaveQuantity);
    }
  };

  const handleSlaveTableChange = (table: SlaveTable) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, slaveTable: table } : t))
    );
    refreshSlaveSlice(activeTab.id, table, activeTab.slaveStartAddr, activeTab.slaveQuantity);
  };

  // --- Scanner Apply Handlers ---

  // Goes through handleSaveDefinition so a running poll is restarted with the new Slave ID.
  const handleApplySlaveId = (slaveId: number) => {
    handleSaveDefinition({ ...activeTab.definition, slave_id: slaveId });
  };

  const handleApplyScannerConnection = async (port: string, baud: number, parity: string) => {
    const cfg: ConnectionConfig = {
      type: 'serial',
      port,
      baud_rate: baud,
      data_bits: 8,
      parity,
      stop_bits: 1,
      timeout_ms: 1000,
    };
    await handleConnect(cfg);
  };

  const handleSaveDefinition = async (newDef: PollDefinition) => {
    const tabId = activeTabId;
    const currentState = tabStates[tabId];

    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, definition: newDef } : t))
    );

    // Reset cached old range data to avoid old data being shown under new address labels
    updateTabState(tabId, (prev) => ({
      ...prev,
      regs: [],
      coils: [],
      lastValues: [],
      hasData: false,
    }));

    if (currentState?.isPolling) {
      try {
        await sessionStopPolling(tabId);
        await sessionStartPolling(tabId, newDef);
      } catch (err) {
        console.error('Lỗi khởi động lại polling khi đổi cấu hình:', err);
        // Polling was stopped and did not restart: never keep showing "Polling".
        updateTabState(tabId, (prev) => ({ ...prev, isPolling: false }));
        notify('error', `Không khởi động lại được Polling với cấu hình mới: ${err}`);
      }
    }
  };

  const handleApplyScannerRange = (fc: number, startAddr: number, qty: number) =>
    handleSaveDefinition({
      ...activeTab.definition,
      function_code: fc,
      start_address: startAddr,
      quantity: Math.min(100, Math.max(1, qty), 65536 - startAddr),
    });

  // --- Inline Write & Coil Toggle Handlers ---

  // Writes a typed value to one row of a tab, with every check (read-only tables, format range,
  // scaling, FC06/FC16). Returns an error message, or null on success. Used by inline edits on
  // the desktop and by writes coming from the phone.
  const performWrite = async (tabId: string, address: number, valueStr: string): Promise<string | null> => {
    const targetTab = tabsRef.current.find((t) => t.id === tabId);
    if (!targetTab) return `Không tìm thấy sheet ${tabId}.`;
    try {
      if (targetTab.role !== 'slave' && isReadOnlyFunction(targetTab.definition.function_code)) {
        return 'FC02/FC04 là bảng chỉ đọc, không thể ghi.';
      }

      const isCoilType = isCoilTab(targetTab);

      if (isCoilType) {
        const valLower = valueStr.trim().toLowerCase();
        // Unknown text must not silently become OFF.
        if (!['1', '0', 'true', 'false', 'on', 'off'].includes(valLower)) {
          return `Giá trị coil "${valueStr}" không hợp lệ (dùng 1/0, ON/OFF, true/false).`;
        }
        const boolVal = valLower === '1' || valLower === 'true' || valLower === 'on';
        if (targetTab.role === 'slave') {
          await slaveSetCoil(targetTab.id, targetTab.slaveTable, address, boolVal);
          await refreshSlaveSlice(targetTab.id, targetTab.slaveTable, targetTab.slaveStartAddr, targetTab.slaveQuantity);
        } else {
          await sessionWriteCoil(targetTab.id, {
            slave_id: targetTab.definition.slave_id,
            address,
            value: boolVal,
          });
        }
        return null;
      }

      // Register write supporting Signed16, Float32, Long, UInt32 multi-registers
      const format = targetTab.formats?.[address] ?? targetTab.format;
      const scaling = targetTab.scalings?.[address] ?? 1;
      const encoded = encodeRegisterInput(valueStr, format, scaling);
      if (!encoded.ok) {
        return encoded.error;
      }
      // Check the whole range before writing anything: a value must not wrap past 65535 or be
      // left half-written (slave mode writes word by word).
      if (address + encoded.values.length > 65536) {
        return `Giá trị ${format} cần ${encoded.values.length} thanh ghi từ địa chỉ ${address}, vượt quá địa chỉ 65535.`;
      }

      if (targetTab.role === 'slave') {
        for (let i = 0; i < encoded.values.length; i++) {
          await slaveSetRegister(targetTab.id, targetTab.slaveTable, address + i, encoded.values[i]);
        }
        await refreshSlaveSlice(targetTab.id, targetTab.slaveTable, targetTab.slaveStartAddr, targetTab.slaveQuantity);
      } else {
        if (encoded.values.length === 1) {
          await sessionWriteRegister(targetTab.id, {
            slave_id: targetTab.definition.slave_id,
            address,
            value: encoded.values[0],
          });
        } else {
          await sessionWriteRegisters(targetTab.id, {
            slave_id: targetTab.definition.slave_id,
            address,
            values: encoded.values,
          });
        }
      }
      return null;
    } catch (err) {
      return `Lỗi ghi dữ liệu: ${err}`;
    }
  };

  const handleInlineWriteForTab = async (tabId: string, address: number, valueStr: string) => {
    const error = await performWrite(tabId, address, valueStr);
    if (error) notify('error', error);
  };

  // Phone writes go through the same performWrite as desktop edits.
  const performWriteRef = useRef(performWrite);
  performWriteRef.current = performWrite;
  useEffect(() => {
    return subscribeRemoteWrite(async (req) => {
      const text = req.is_coil ? (req.bool_value ? '1' : '0') : req.text;
      const tabId = req.tab_id || activeTabRef.current.id;
      const error = await performWriteRef.current(tabId, req.address, text);
      await completeRemoteWrite(req.id, error || '');
    });
  }, []);

  const handleToggleCoilForTab = async (tabId: string, address: number, currentVal: boolean) => {
    const targetTab = tabs.find((t) => t.id === tabId) || activeTab;
    try {
      if (targetTab.role !== 'slave' && isReadOnlyFunction(targetTab.definition.function_code)) {
        notify('error', 'FC02 (Discrete Inputs) là bảng chỉ đọc, không thể bật/tắt.');
        return;
      }
      if (targetTab.role === 'slave') {
        await slaveSetCoil(targetTab.id, targetTab.slaveTable, address, !currentVal);
        await refreshSlaveSlice(targetTab.id, targetTab.slaveTable, targetTab.slaveStartAddr, targetTab.slaveQuantity);
      } else {
        await sessionWriteCoil(targetTab.id, {
          slave_id: targetTab.definition.slave_id,
          address,
          value: !currentVal,
        });
      }
    } catch (err) {
      notify('error', `Lỗi chuyển trạng thái Coil: ${err}`);
    }
  };

  // --- Tab Management ---

  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: `Sheet ${tabs.length + 1}`,
      role: 'master',
      definition: {
        ...DEFAULT_DEFINITION,
        slave_id: tabs.length + 1,
      },
      format: 'unsigned16',
      aliases: {},
      units: {},
      scalings: {},
      slaveConfig: {
        ...DEFAULT_SLAVE_CONFIG,
        // Next free port: tabs.length would repeat a port after a tab is closed.
        port_tcp: Math.max(5019, ...tabs.map((t) => t.slaveConfig?.port_tcp ?? 0)) + 1,
        slave_id: tabs.length + 1,
      },
      slaveTable: 'holding',
      slaveStartAddr: 0,
      slaveQuantity: 10,
    };

    setTabs([...tabs, newTab]);
    setTabStates((prev) => ({ ...prev, [newId]: createEmptyTabState() }));
    setActiveTabId(newId);
  };

  const handleCloseTab = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;

    // Clean up background session resources in Go backend
    // CloseSession stops polling, disconnects the master and stops the slave + simulation.
    try {
      await closeSession(id);
    } catch (err) {
      console.error(`Lỗi dọn dẹp session khi đóng tab ${id}:`, err);
    }

    // Backend teardown above can take a while (serial close); derive everything from the latest
    // state so a second close or an edit meanwhile is not lost.
    setTabs((prev) => prev.filter((t) => t.id !== id));
    const remaining = tabsRef.current.filter((t) => t.id !== id);
    setTabStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Drop the closed tab's chart traces and their history; they could no longer be toggled.
    const closedTraceIds = new Set(chartTracesRef.current.filter((t) => t.tabId === id).map((t) => t.id));
    if (closedTraceIds.size > 0) {
      setChartTraces((prev) => prev.filter((t) => t.tabId !== id));
      setTraceData((prev) => {
        const next = { ...prev };
        closedTraceIds.forEach((traceId) => delete next[traceId]);
        return next;
      });
    }

    if (remaining.length === 0) return;
    setActiveTabId((cur) => (cur === id ? remaining[0].id : cur));
    setSplitTabId((cur) => {
      if (cur !== id) return cur;
      const active = activeTabRef.current.id === id ? remaining[0].id : activeTabRef.current.id;
      return remaining.find((t) => t.id !== active)?.id ?? '';
    });
  };

  const handleRenameTab = (id: string, newTitle: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: newTitle } : t))
    );
  };

  const handleSaveProject = () => {
    exportProjectToFile(tabs, activeTabId, 'NXChieu_Modbus_Project');
  };

  const handleOpenProjectClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Parse and validate first: a bad file must not tear down the current workspace.
      const imported = await importProjectFromFile(file);

      for (const t of tabs) {
        try {
          await closeSession(t.id);
        } catch (err) {
          console.error(`Lỗi dọn dẹp session cũ ${t.id}:`, err);
        }
      }

      // Imported tabs may reuse IDs such as tab-1; drop every old runtime state so nothing shows
      // Connected/Polling for sessions that were just closed.
      setTabStates({});
      setChartTraces([]);
      setTraceData({});
      setIsSplitView(false);
      setSplitTabId('');
      setTabs(imported.tabs);
      setActiveTabId(imported.activeTabId);
      notify('success', `Đã nạp dự án "${imported.projectName}" gồm ${imported.tabs.length} sheet.`);
    } catch (err) {
      notify('error', `Lỗi nạp file dự án: ${err}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // --- Cell Metadata Updaters ---

  // Per-row settings (alias, unit, scaling) live in one map per tab keyed by address.
  const updateRowSetting = <K extends 'aliases' | 'units' | 'scalings'>(
    tabId: string,
    key: K,
    address: number,
    value: TabSession[K][number]
  ) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, [key]: { ...t[key], [address]: value } } : t))
    );
  };
  const handleUpdateAlias = (tabId: string, address: number, alias: string) =>
    updateRowSetting(tabId, 'aliases', address, alias);
  const handleUpdateUnit = (tabId: string, address: number, unit: string) =>
    updateRowSetting(tabId, 'units', address, unit);
  const handleUpdateScaling = (tabId: string, address: number, scaling: number) => {
    // A cleared or invalid factor (NaN, 0) would blank or zero every value of the row.
    if (Number.isFinite(scaling) && scaling !== 0) updateRowSetting(tabId, 'scalings', address, scaling);
  };

  const handleUpdateFormat = (tabId: string, address: number, format: DataFormat) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const newFormats = { ...(t.formats || {}) };
        if (!format) {
          delete newFormats[address];
        } else {
          newFormats[address] = format;
        }
        return { ...t, formats: newFormats };
      })
    );
  };

  // --- Split View Management ---

  const handleToggleSplitView = () => {
    if (!isSplitView) {
      if (tabs.length === 1) {
        const newId = `tab-${Date.now()}`;
        const newTab: TabSession = {
          id: newId,
          title: 'Sheet 2 (Slave Sim)',
          role: 'slave',
          definition: { ...DEFAULT_DEFINITION, slave_id: 2 },
          format: 'unsigned16',
          aliases: { 0: 'Slave Telemetry 1' },
          units: { 0: 'V' },
          scalings: { 0: 1 },
          slaveConfig: { ...DEFAULT_SLAVE_CONFIG, port_tcp: 5021, slave_id: 2 },
          slaveTable: 'holding',
          slaveStartAddr: 0,
          slaveQuantity: 10,
        };
        setTabs((prev) => [...prev, newTab]);
        setTabStates((prev) => ({ ...prev, [newId]: createEmptyTabState() }));
        setSplitTabId(newId);
      } else {
        const otherTab = tabs.find((t) => t.id !== activeTabId);
        if (otherTab) {
          setSplitTabId(otherTab.id);
        }
      }
      setIsSplitView(true);
    } else {
      setIsSplitView(false);
    }
  };

  // --- Realtime Multi-Trace Chart Management ---

  const handleToggleTrace = (tab: TabSession, row: RegisterRow) => {
    const traceId = `${tab.id}_${row.address}`;
    const existingIdx = chartTraces.findIndex((t) => t.id === traceId);

    if (existingIdx >= 0) {
      // Toggle off / remove trace
      const updated = chartTraces.filter((t) => t.id !== traceId);
      setChartTraces(updated);
      if (updated.length === 0) {
        setIsChartVisible(false);
      }
    } else {
      // Add new trace with auto-cycling color
      // First colour not in use; length-based picking repeats colours after a removal.
      const used = new Set(chartTraces.map((t) => t.color));
      const nextColor = TRACE_PALETTE.find((c) => !used.has(c)) ?? TRACE_PALETTE[chartTraces.length % TRACE_PALETTE.length];
      const newTrace: ChartTrace = {
        id: traceId,
        tabId: tab.id,
        tabTitle: tab.title,
        address: row.address,
        label: row.alias || `Register ${row.address}`,
        unit: row.unit || '',
        displayAddress: row.displayAddress,
        color: nextColor,
        visible: true,
      };

      setChartTraces((prev) => [...prev, newTrace]);
      setIsChartVisible(true);

      // Seed initial data point if row has value
      if (row.hasValue) {
        const state = tabStates[tab.id];
        const start = tab.role === 'slave' ? tab.slaveStartAddr : tab.definition.start_address;
        const fmt = tab.formats?.[row.address] || tab.format;
        const val = state
          ? sampleTrace(state.regs, state.coils, row.address - start, fmt, tab.scalings?.[row.address] ?? 1)
          : NaN;
        if (Number.isFinite(val)) {
          const timeNow = new Date();
          const timeStr = clockStamp(timeNow);
          setTraceData((prev) => ({
            ...prev,
            [traceId]: [{ timestamp: timeStr, timeMs: timeNow.getTime(), value: val }],
          }));
        }
      }
    }
  };

  const handleToggleTraceVisibility = (traceId: string) => {
    setChartTraces((prev) =>
      prev.map((t) => (t.id === traceId ? { ...t, visible: !t.visible } : t))
    );
  };

  const handleRemoveTrace = (traceId: string) => {
    const updated = chartTraces.filter((t) => t.id !== traceId);
    setChartTraces(updated);
    if (updated.length === 0) {
      setIsChartVisible(false);
    }
  };

  const handleClearAllChart = () => {
    setTraceData({});
  };

  const activeRowsObj = useMemo(() => buildRowsForTab(activeTab, activeState), [activeTab, activeState]);

  const remoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteSourceRef = useRef({ tabs, tabStates, activeTabId });
  remoteSourceRef.current = { tabs, tabStates, activeTabId };

  // Broadcast live state of every sheet to the Mobile Remote Server, so a phone can browse any
  // sheet, not only the one open on the desktop. Rows are built inside the timer from the latest
  // state, at most twice per second, instead of on every poll.
  useEffect(() => {
    if (remoteTimerRef.current) return;
    remoteTimerRef.current = setTimeout(() => {
      remoteTimerRef.current = null;
      const src = remoteSourceRef.current;
      const sheets: Record<string, unknown[]> = {};
      for (const t of src.tabs) {
        const state = src.tabStates[t.id] || createEmptyTabState();
        sheets[t.id] = buildRowsForTab(t, state).rows.map((r) => ({
          address: r.address,
          displayAddress: r.displayAddress,
          alias: r.alias,
          displayValue: r.displayValue,
          rawValue: r.rawValue,
          rawHex: r.rawHex,
          unit: r.unit,
          isCoil: typeof r.rawValue === 'boolean',
        }));
      }
      updateRemoteServerState({
        active_tab_id: src.activeTabId,
        tabs: src.tabs.map((t) => ({ id: t.id, title: t.title, role: t.role, slaveId: t.definition.slave_id })),
        sheets,
        rows: sheets[src.activeTabId] || [],
        timestamp: new Date().toLocaleTimeString('vi-VN'),
      });
    }, 500);
  }, [activeTabId, tabs, tabStates]);

  useEffect(() => () => {
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
  }, []);

  // Compute split tab & rows if Split View is active
  const splitTab =
    tabs.find((t) => t.id === splitTabId) ||
    tabs.find((t) => t.id !== activeTabId) ||
    activeTab;
  const splitState = tabStates[splitTab.id] || createEmptyTabState();
  const splitRowsObj = useMemo(
    () => (isSplitView ? buildRowsForTab(splitTab, splitState) : { rows: [] as RegisterRow[], isCoil: false }),
    [isSplitView, splitTab, splitState]
  );

  overlayOpenRef.current = isProtocolAnalyzerOpen || isAnalyzerStudioOpen || isDiagnosticsOpen;
  hotkeyActionsRef.current = {
    connectToggle: () => {
      if (activeTab.role !== 'master') return;
      if (activeState.isConnected) handleDisconnect();
      else setIsConnectionModalOpen(true);
    },
    readOnce: () => {
      if (activeTab.role === 'master') handleReadOnce();
    },
    definition: () => setIsDefinitionModalOpen(true),
  };

  // Stable DataGrid callbacks per tab. They always call the latest handlers through a ref, so
  // the memoized DataGrid is not re-rendered just because App re-rendered.
  const gridHandlersRef = useRef({
    handleUpdateAlias,
    handleUpdateUnit,
    handleUpdateScaling,
    handleUpdateFormat,
    handleInlineWriteForTab,
    handleToggleCoilForTab,
    handleToggleTrace,
  });
  gridHandlersRef.current = {
    handleUpdateAlias,
    handleUpdateUnit,
    handleUpdateScaling,
    handleUpdateFormat,
    handleInlineWriteForTab,
    handleToggleCoilForTab,
    handleToggleTrace,
  };
  const createGridHandlers = (tabId: string) => {
    const h = () => gridHandlersRef.current;
    const findTab = () => tabsRef.current.find((t) => t.id === tabId);
    return {
      onRowDoubleClick: (row: RegisterRow) => {
        const tab = findTab();
        if (!tab) return;
        setSelectedRowForWrite(row);
        setSelectedTabForWrite(tab);
        setIsWriteModalOpen(true);
      },
      onUpdateAlias: (addr: number, val: string) => h().handleUpdateAlias(tabId, addr, val),
      onUpdateUnit: (addr: number, val: string) => h().handleUpdateUnit(tabId, addr, val),
      onUpdateScaling: (addr: number, val: number) => h().handleUpdateScaling(tabId, addr, val),
      onUpdateFormat: (addr: number, fmt: DataFormat) => h().handleUpdateFormat(tabId, addr, fmt),
      onInlineWrite: (addr: number, val: string) => h().handleInlineWriteForTab(tabId, addr, val),
      onToggleCoil: (addr: number, cur: boolean) => h().handleToggleCoilForTab(tabId, addr, cur),
      onOpenChart: (row: RegisterRow) => {
        const tab = findTab();
        if (tab) h().handleToggleTrace(tab, row);
      },
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeGridHandlers = useMemo(() => createGridHandlers(activeTab.id), [activeTab.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const splitGridHandlers = useMemo(() => createGridHandlers(splitTab.id), [splitTab.id]);

  // Trace Color Maps for DataGrid row indicators
  const activeChartColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    chartTraces.forEach((t) => {
      if (t.tabId === activeTab.id) {
        map[t.address] = t.color;
      }
    });
    return map;
  }, [chartTraces, activeTab.id]);

  const splitChartColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    chartTraces.forEach((t) => {
      if (t.tabId === splitTab.id) {
        map[t.address] = t.color;
      }
    });
    return map;
  }, [chartTraces, splitTab.id]);

  const handleExportCSV = () => {
    exportSheetToCSV(activeTab, activeRowsObj.rows);
  };

  // Selected row for QuickInspector
  const inspectorSelectedRow = useMemo(() => {
    if (selectedRowAddress === null) return activeRowsObj.rows[0] || null;
    return activeRowsObj.rows.find((r) => r.address === selectedRowAddress) || activeRowsObj.rows[0] || null;
  }, [activeRowsObj.rows, selectedRowAddress]);

  const isCurrentTabReadOnly = activeTab.role === 'master' && (activeTab.definition.function_code === 2 || activeTab.definition.function_code === 4);
  const isInspectorRowTracing = useMemo(() => {
    if (!inspectorSelectedRow) return false;
    return chartTraces.some((t) => t.tabId === activeTab.id && t.address === inspectorSelectedRow.address);
  }, [chartTraces, activeTab.id, inspectorSelectedRow]);

  const runStudioDiagnostics = async (): Promise<DiagnosticCheck[]> => {
    const results: DiagnosticCheck[] = [];
    const check = async (name: string, action: () => Promise<string>) => {
      const started = performance.now();
      try {
        const detail = await action();
        results.push({ name, status: 'pass', detail, durationMs: Math.round(performance.now() - started) });
        return true;
      } catch (error) {
        results.push({ name, status: 'fail', detail: String(error), durationMs: Math.round(performance.now() - started) });
        return false;
      }
    };

    const bridgeReady = await check('Wails desktop bridge', async () => {
      if (!(window as any).go?.main?.App) throw new Error('Không thấy Wails bridge. Hãy chạy file EXE thay vì mở frontend bằng trình duyệt.');
      return 'Frontend đã kết nối được với Go backend.';
    });
    if (!bridgeReady) return results;

    await check('Nhận diện cổng truyền thông', async () => {
      const ports = await listSerialPorts();
      return `Backend phản hồi ${ports.length} cổng COM.`;
    });

    const masterID = `__studio_diagnostic_master_${Date.now()}`;
    let masterConnected = false;
    try {
      masterConnected = await check('Master simulator: kết nối', async () => {
        await sessionConnect(masterID, { type: 'serial', port: 'simulator', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, timeout_ms: 1000 });
        return 'Session simulator đã kết nối.';
      });
      if (masterConnected) {
        await check('Master simulator: đọc và ghi', async () => {
          const definition: PollDefinition = { slave_id: 1, function_code: 3, start_address: 20, quantity: 2, scan_rate_ms: 50 };
          const before = await sessionReadOnce(masterID, definition);
          if (before.error || before.values.length !== 2) throw new Error(before.error || 'Read Once không trả đủ dữ liệu.');
          await sessionWriteRegister(masterID, { slave_id: 1, address: 20, value: 4321 });
          const after = await sessionReadOnce(masterID, definition);
          if (after.error || after.values[0] !== 4321) throw new Error(after.error || `Giá trị đọc lại là ${after.values[0]}, mong đợi 4321.`);
          return 'Read Once và FC06 round-trip thành công.';
        });
        await check('Scanner: Unit, baudrate và register', async () => {
          const [devices, baud, registers] = await Promise.all([
            scanSlaveIDs(masterID, 1, 3, 50),
            autoDetectBaudrate('simulator', 1, [9600], ['none']),
            scanRegisters(masterID, 3, 0, 4),
          ]);
          if (devices[0]?.status !== 'online' || !baud[0]?.success || !registers[0]?.valid) throw new Error('Scanner không nhận diện đúng simulator.');
          return 'Unit 1, 9600-none và vùng Holding Register đều được nhận diện.';
        });
        await check('Polling và Analyzer pipeline', async () => {
          const definition: PollDefinition = { slave_id: 1, function_code: 3, start_address: 0, quantity: 4, scan_rate_ms: 50 };
          await sessionStartPolling(masterID, definition);
          await new Promise((resolve) => window.setTimeout(resolve, 130));
          await sessionStopPolling(masterID);
          // Self-test traffic goes to a separate analyzer so it never pollutes the real baseline,
          // health score, reports or saved captures.
          const snapshot = await getDiagnosticSnifferSnapshot(50);
          const diagnosticFrames = snapshot.frames.filter((frame) => frame.source_id === masterID);
          if (!diagnosticFrames.length) throw new Error('Polling chạy nhưng Analyzer chưa nhận được frame của phiên tự kiểm tra.');
          return `Analyzer nhận ${diagnosticFrames.length} frame từ phiên tự kiểm tra.`;
        });
      }
    } finally {
      if (masterConnected) await sessionDisconnect(masterID).catch(() => undefined);
      await closeSession(masterID).catch(() => undefined);
    }

    const slaveID = `__studio_diagnostic_slave_${Date.now()}`;
    try {
      await check('Slave memory: register và coil', async () => {
        await slaveSetRegister(slaveID, 'holding', 7, 2468);
        await slaveSetCoil(slaveID, 'coils', 3, true);
        const [registers, coils] = await Promise.all([
          slaveGetSlice(slaveID, 'holding', 7, 1),
          slaveGetSlice(slaveID, 'coils', 3, 1),
        ]);
        if (registers.values?.[0] !== 2468 || coils.bool_values?.[0] !== true) throw new Error('Bộ nhớ Slave không giữ đúng dữ liệu đã ghi.');
        return 'Holding register và coil round-trip thành công.';
      });
      await check('Slave simulation', async () => {
        await slaveSetRegister(slaveID, 'holding', 50, 100);
        await slaveStartSim(slaveID, { session_id: slaveID, table: 'holding', address: 50, mode: 'increment', min: 0, max: 1000, step: 2, interval_ms: 100 });
        await new Promise((resolve) => window.setTimeout(resolve, 130));
        await slaveStopSim(slaveID);
        const values = await slaveGetSlice(slaveID, 'holding', 50, 1);
        if (values.values?.[0] === 100) throw new Error('Simulation chạy nhưng giá trị không thay đổi.');
        return `Thanh ghi mô phỏng đã thay đổi thành ${values.values?.[0]}.`;
      });
    } finally {
      await closeSession(slaveID).catch(() => undefined);
    }
    return results;
  };

  // Determine which tab is targeted by the Write Modal
  const modalTab = selectedTabForWrite || activeTab;

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans text-slate-100 ${frontendMode === 'studio' ? 'nx-studio-mode' : ''}`}>
      {/* Hidden File Input for Project Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".nxmodbus,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 1. Menu Bar. The classic shell is only mounted in classic mode; hidden with display:none
          it kept re-rendering its grids and a second trend chart on every poll under Studio. */}
      {frontendMode === 'classic' && (
      <div className="contents">
      <MenuBar
        role={activeTab.role}
        onRoleChange={handleRoleChange}
        isConnected={activeState.isConnected}
        isPolling={activeState.isPolling}
        isListening={activeState.isListening}
        onOpenConnection={() => setIsConnectionModalOpen(true)}
        onDisconnect={handleDisconnect}
        onOpenDefinition={() => setIsDefinitionModalOpen(true)}
        onOpenSlaveSetup={() => setIsSlaveModalOpen(true)}
        onTogglePoll={handleTogglePoll}
        onToggleSlaveServer={handleToggleSlaveServer}
        onReadOnce={handleReadOnce}
        onClearCounters={() => {
          sessionResetCounters(activeTab.id).catch((err) => console.error('Reset counters failed:', err));
          updateTabState(activeTab.id, (prev) => ({ ...prev, txCount: 0, errCount: 0 }));
        }}
        onQuickSimulate={() =>
          handleConnect({
            type: 'serial',
            port: 'simulator',
            baud_rate: 9600,
            data_bits: 8,
            parity: 'none',
            stop_bits: 1,
            timeout_ms: 1000,
          })
        }
        onOpenProject={handleOpenProjectClick}
        onSaveProject={handleSaveProject}
        onExportCSV={handleExportCSV}
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        showTraffic={showTraffic}
        isSplitView={isSplitView}
        onToggleSplitView={handleToggleSplitView}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector(!showInspector)}
        onOpenScanner={() => setIsScannerModalOpen(true)}
        onOpenMobileRemote={() => setIsMobileModalOpen(true)}
        onOpenProtocolAnalyzer={() => { setIsAnalyzerStudioOpen(false); setIsProtocolAnalyzerOpen(true); }}
        onOpenHelp={() => setIsHelpModalOpen(true)}
      />

      {/* 2. Toolbar */}
      <Toolbar
        role={activeTab.role}
        onRoleChange={handleRoleChange}
        isConnected={activeState.isConnected}
        isPolling={activeState.isPolling}
        format={activeTab.format}
        onFormatChange={(fmt) =>
          setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, format: fmt } : t)))
        }
        onConnectClick={() => setIsConnectionModalOpen(true)}
        onDisconnectClick={handleDisconnect}
        onDefinitionClick={() => setIsDefinitionModalOpen(true)}
        onTogglePoll={handleTogglePoll}
        onReadOnce={handleReadOnce}
        onClearCounters={() => {
          // Reset in the backend too; otherwise the next poll restores its running totals.
          sessionResetCounters(activeTab.id).catch((err) => console.error('Reset counters failed:', err));
          updateTabState(activeTab.id, (prev) => ({ ...prev, txCount: 0, errCount: 0 }));
        }}
        isListening={activeState.isListening}
        slaveTable={activeTab.slaveTable}
        onTableChange={handleSlaveTableChange}
        onOpenSlaveModal={() => setIsSlaveModalOpen(true)}
        onToggleSlaveServer={handleToggleSlaveServer}
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        showTraffic={showTraffic}
        onNewTab={handleAddTab}
        isSplitView={isSplitView}
        onToggleSplitView={handleToggleSplitView}
        hasActiveChart={chartTraces.length > 0}
        onToggleChart={() => setIsChartVisible(!isChartVisible)}
        onOpenHelp={() => setIsHelpModalOpen(true)}
        onOpenScanner={() => setIsScannerModalOpen(true)}
        onOpenMobileRemote={() => setIsMobileModalOpen(true)}
        onOpenProtocolAnalyzer={() => { setIsAnalyzerStudioOpen(false); setIsProtocolAnalyzerOpen(true); }}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector(!showInspector)}
      />

      {/* 3. Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onAddTab={handleAddTab}
        onRenameTab={handleRenameTab}
      />

      {/* 4. Main Data Grid Viewport (Single View or Split Dual View) with QuickInspector */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {!isSplitView ? (
            <DataGrid
              rows={activeRowsObj.rows}
              isCoil={activeRowsObj.isCoil}
              sheetFormat={activeTab.format}
              selectedAddress={inspectorSelectedRow?.address}
              onSelectRow={(row) => setSelectedRowAddress(row.address)}
              {...activeGridHandlers}
              activeChartColorMap={activeChartColorMap}
            />
          ) : (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden bg-slate-950">
              {/* Left Panel: Active Tab */}
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300 font-medium select-none">
                  <span className="flex items-center space-x-1.5 text-cyan-400 font-bold">
                    <span>◫ Cửa sổ 1: {activeTab.title}</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      ({activeTab.role === 'master' ? 'Master Poll' : 'Slave Server'})
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">Sheet chính</span>
                </div>
                <DataGrid
                  rows={activeRowsObj.rows}
                  isCoil={activeRowsObj.isCoil}
                  sheetFormat={activeTab.format}
                  selectedAddress={inspectorSelectedRow?.address}
                  onSelectRow={(row) => setSelectedRowAddress(row.address)}
                  {...activeGridHandlers}
                  activeChartColorMap={activeChartColorMap}
                />
              </div>

              {/* Right Panel: Split Tab */}
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300 font-medium select-none">
                  <div className="flex items-center space-x-2">
                    <span className="text-indigo-400 font-bold">◫ Cửa sổ 2:</span>
                    <select
                      value={splitTab.id}
                      onChange={(e) => setSplitTabId(e.target.value)}
                      className="bg-slate-950 text-indigo-300 text-xs border border-slate-700 rounded px-2 py-0.5 focus:outline-none focus:border-cyan-400 cursor-pointer font-semibold"
                    >
                      {tabs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} ({t.role === 'master' ? 'Master' : 'Slave'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setIsSplitView(false)}
                    className="text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded text-xs transition-colors"
                    title="Đóng chế độ xem song song"
                  >
                    ✕ Đóng Split
                  </button>
                </div>
                <DataGrid
                  rows={splitRowsObj.rows}
                  isCoil={splitRowsObj.isCoil}
                  sheetFormat={splitTab.format}
                  {...splitGridHandlers}
                  activeChartColorMap={splitChartColorMap}
                />
              </div>
            </div>
          )}

          {/* Quick Inspector Side Panel */}
          {showInspector && !isSplitView && (
            <QuickInspector
              selectedRow={inspectorSelectedRow}
              isCoil={activeRowsObj.isCoil}
              isReadOnly={isCurrentTabReadOnly}
              sheetFormat={activeTab.format}
              onClose={() => setShowInspector(false)}
              onUpdateAlias={(addr, alias) => handleUpdateAlias(activeTab.id, addr, alias)}
              onUpdateUnit={(addr, unit) => handleUpdateUnit(activeTab.id, addr, unit)}
              onUpdateScaling={(addr, scaling) => handleUpdateScaling(activeTab.id, addr, scaling)}
              onUpdateFormat={(addr, fmt) => handleUpdateFormat(activeTab.id, addr, fmt)}
              onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
              onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
              onOpenChart={(row) => handleToggleTrace(activeTab, row)}
              isTracing={isInspectorRowTracing}
            />
          )}
        </div>

        {/* Realtime Multi-Trace Trend Chart Drawer (MQTT Explorer style) */}
        {chartTraces.length > 0 && isChartVisible && (
          <TrendChart
            traces={chartTraces}
            traceData={traceData}
            onToggleTraceVisibility={handleToggleTraceVisibility}
            onRemoveTrace={handleRemoveTrace}
            onClear={handleClearAllChart}
            onClose={() => setIsChartVisible(false)}
          />
        )}
      </div>

      {/* 5. Communication Traffic Box (Hex frame sniffer) */}
      {showTraffic && (
        <TrafficBox
          entries={activeState.traffic}
          onClear={() => updateTabState(activeTab.id, (prev) => ({ ...prev, traffic: [] }))}
          onOpenAnalyzer={() => { setIsAnalyzerStudioOpen(false); setIsProtocolAnalyzerOpen(true); }}
        />
      )}

      {/* 6. Status Bar */}
      <StatusBar
        role={activeTab.role}
        isConnected={activeState.isConnected}
        isPolling={activeState.isPolling}
        connectionConfig={activeState.connectionConfig}
        definition={activeTab.definition}
        txCount={activeState.txCount}
        errCount={activeState.errCount}
        latencyMs={activeState.latencyMs}
        isListening={activeState.isListening}
        slaveConfig={activeTab.slaveConfig}
        slaveTable={activeTab.slaveTable}
        slaveActivityCount={activeState.slaveActivityCount}
      />
      </div>
      )}

      {/* A Studio crash (or chunk load failure) falls back to the classic UI instead of a white
          screen that would come back on every launch, since the mode is remembered. */}
      <ErrorBoundary
        key={frontendMode}
        name="Workspace Studio"
        onError={() => {
          setFrontendMode('classic');
          notify('error', 'Giao diện Studio gặp lỗi và đã chuyển về giao diện cổ điển.');
        }}
      >
      <Suspense fallback={<div className="flex flex-1 items-center justify-center bg-[#07100e] text-xs text-emerald-200">Đang mở Workspace Studio…</div>}>
      {frontendMode === 'studio' && (
        <WorkspaceStudio
          tabs={tabs}
          activeTab={activeTab}
          activeTabId={activeTabId}
          runtime={activeState}
          primary={{ tab: activeTab, rows: activeRowsObj.rows, isCoil: activeRowsObj.isCoil, handlers: activeGridHandlers, chartColors: activeChartColorMap }}
          secondary={{ tab: splitTab, rows: splitRowsObj.rows, isCoil: splitRowsObj.isCoil, handlers: splitGridHandlers, chartColors: splitChartColorMap }}
          splitView={isSplitView}
          showTraffic={showTraffic}
          chart={chartTraces.length > 0 && isChartVisible ? (
            <TrendChart
              traces={chartTraces}
              traceData={traceData}
              onToggleTraceVisibility={handleToggleTraceVisibility}
              onRemoveTrace={handleRemoveTrace}
              onClear={handleClearAllChart}
              onClose={() => setIsChartVisible(false)}
            />
          ) : undefined}
          onUseClassic={() => setFrontendMode('classic')}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onAddTab={handleAddTab}
          onRenameTab={handleRenameTab}
          onRoleChange={handleRoleChange}
          onFormatChange={(fmt) => setTabs((prev) => prev.map((tab) => tab.id === activeTabId ? { ...tab, format: fmt } : tab))}
          onTableChange={handleSlaveTableChange}
          onSecondaryTabChange={setSplitTabId}
          onConnect={() => setIsConnectionModalOpen(true)}
          onDisconnect={handleDisconnect}
          onDefinition={() => setIsDefinitionModalOpen(true)}
          onTogglePoll={handleTogglePoll}
          onReadOnce={handleReadOnce}
          onClearCounters={() => {
            sessionResetCounters(activeTab.id).catch((err) => console.error('Reset counters failed:', err));
            updateTabState(activeTab.id, (prev) => ({ ...prev, txCount: 0, errCount: 0 }));
          }}
          onSlaveSetup={() => setIsSlaveModalOpen(true)}
          onToggleSlave={handleToggleSlaveServer}
          onOpenProject={handleOpenProjectClick}
          onSaveProject={handleSaveProject}
          onExportCSV={handleExportCSV}
          onOpenScanner={() => setIsScannerModalOpen(true)}
          onOpenMobile={() => setIsMobileModalOpen(true)}
          onOpenAnalyzerStudio={() => { setIsProtocolAnalyzerOpen(false); setIsAnalyzerStudioOpen(true); }}
          onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
          onOpenHelp={() => setIsHelpModalOpen(true)}
          onToggleTraffic={() => setShowTraffic(!showTraffic)}
          onClearTraffic={() => updateTabState(activeTab.id, (prev) => ({ ...prev, traffic: [] }))}
          onToggleSplit={handleToggleSplitView}
          onToggleChart={() => setIsChartVisible(!isChartVisible)}
        />
      )}
      </Suspense>
      </ErrorBoundary>

      <ErrorBoundary
        key={`${isProtocolAnalyzerOpen}-${isAnalyzerStudioOpen}`}
        name="Analyzer"
        onError={() => {
          setIsProtocolAnalyzerOpen(false);
          setIsAnalyzerStudioOpen(false);
          notify('error', 'Analyzer gặp lỗi và đã được đóng.');
        }}
      >
      <Suspense fallback={<div className="fixed inset-0 z-[90] grid place-items-center bg-[#07100e] text-xs text-emerald-200">Đang mở Analyzer…</div>}>
        {isProtocolAnalyzerOpen && <ProtocolAnalyzer isOpen onClose={() => setIsProtocolAnalyzerOpen(false)} />}
        {isAnalyzerStudioOpen && <AnalyzerStudio
          isOpen
          onClose={() => setIsAnalyzerStudioOpen(false)}
          onOpenClassic={() => {
            setIsAnalyzerStudioOpen(false);
            setIsProtocolAnalyzerOpen(true);
          }}
        />}
      </Suspense>
      </ErrorBoundary>

      <StudioDiagnostics isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} onRun={runStudioDiagnostics} />
      <ActionNotice notice={actionNotice} onClose={() => setActionNotice(null)} />

      {/* --- Modals --- */}
      <ConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        onConnect={handleConnect}
        availablePorts={availablePorts}
        onRefreshPorts={refreshPorts}
        currentConfig={activeState.connectionConfig}
      />

      <DefinitionModal
        isOpen={isDefinitionModalOpen}
        onClose={() => setIsDefinitionModalOpen(false)}
        definition={activeTab.definition}
        onSave={handleSaveDefinition}
      />

      <WriteModal
        isOpen={isWriteModalOpen}
        onClose={() => {
          setIsWriteModalOpen(false);
          setSelectedRowForWrite(null);
          setSelectedTabForWrite(null);
        }}
        row={selectedRowForWrite}
        slaveId={modalTab.definition.slave_id}
        readOnly={modalTab.role !== 'slave' && isReadOnlyFunction(modalTab.definition.function_code)}
        isCoil={selectedRowForWrite ? isCoilTab(modalTab) : false}
        onWriteRegister={async (sId, addr, val) => {
          if (modalTab.role === 'slave') {
            await slaveSetRegister(modalTab.id, modalTab.slaveTable, addr, val);
            await refreshSlaveSlice(modalTab.id, modalTab.slaveTable, modalTab.slaveStartAddr, modalTab.slaveQuantity);
          } else {
            await sessionWriteRegister(modalTab.id, { slave_id: sId, address: addr, value: val });
          }
        }}
        onWriteCoil={async (sId, addr, val) => {
          if (modalTab.role === 'slave') {
            await slaveSetCoil(modalTab.id, modalTab.slaveTable, addr, val);
            await refreshSlaveSlice(modalTab.id, modalTab.slaveTable, modalTab.slaveStartAddr, modalTab.slaveQuantity);
          } else {
            await sessionWriteCoil(modalTab.id, { slave_id: sId, address: addr, value: val });
          }
        }}
      />

      <SlaveModal
        isOpen={isSlaveModalOpen}
        onClose={() => setIsSlaveModalOpen(false)}
        isListening={activeState.isListening}
        currentConfig={activeTab.slaveConfig}
        availablePorts={availablePorts}
        onStartServer={handleStartSlaveServer}
        onStopServer={handleStopSlaveServer}
        onStartSim={handleStartSimulation}
        onStopSim={handleStopSimulation}
        isSimulating={activeState.isSimulating}
      />

      {/* 7. Comprehensive Interactive User Guide Modal */}
      <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />

      {/* 8. Modbus Industrial Scanner & Multi-Column Explorer Modal */}
      <ScannerModal
        isOpen={isScannerModalOpen}
        onClose={() => setIsScannerModalOpen(false)}
        activeSession={activeTab}
        onApplySlaveId={handleApplySlaveId}
        onApplyConnection={handleApplyScannerConnection}
        onApplyRange={handleApplyScannerRange}
      />

      {/* 9. Mobile Phone Live Remote Monitor & QR Code Modal */}
      <ErrorBoundary
        key={String(isMobileModalOpen)}
        name="Mobile Remote"
        onError={() => {
          setIsMobileModalOpen(false);
          notify('error', 'Cửa sổ Mobile Remote gặp lỗi và đã được đóng.');
        }}
      >
      <Suspense fallback={null}>
        {isMobileModalOpen && <MobileRemoteModal
          isOpen
          onClose={() => setIsMobileModalOpen(false)}
          sessions={tabs}
          activeSessionId={activeTabId}
          activeRows={activeRowsObj.rows}
        />}
      </Suspense>
      </ErrorBoundary>
    </div>

  );
};

export default App;
