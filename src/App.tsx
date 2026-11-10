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
  completeRemoteWrite,
  updateRemoteServerState,
} from './services/backend';

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
import { StudioDiagnostics } from './components/StudioDiagnostics';
import { ErrorBoundary } from './components/ErrorBoundary';

import { TopQuickBar } from './components/TopQuickBar';
import { SidebarDock, WorkspaceView } from './components/SidebarDock';
import { ScannerView } from './components/ScannerView';
import { DeviceTemplatesModal } from './components/DeviceTemplatesModal';
import { RawSerialStudio } from './components/RawSerialStudio';
import { GatewayBridgeStudio } from './components/GatewayBridgeStudio';
import { DataloggerStudio } from './components/DataloggerStudio';
import { MacroRunnerStudio } from './components/MacroRunnerStudio';
import { openNewInstance } from './services/backend';

const ProtocolAnalyzer = lazy(() => import('./components/ProtocolAnalyzer').then((module) => ({ default: module.ProtocolAnalyzer })));
const AnalyzerStudio = lazy(() => import('./components/AnalyzerStudio').then((module) => ({ default: module.AnalyzerStudio })));
const MobileRemoteModal = lazy(() => import('./components/MobileRemoteModal').then((module) => ({ default: module.MobileRemoteModal })));

import {
  ConnectionConfig,
  DataFormat,
  PollResult,
  PollDefinition,
  RegisterControlConfig,
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
  encodeRegisterInput,
} from './utils/formatters';

import {
  loadWorkspace,
  saveWorkspace,
  exportProjectToFile,
  importProjectFromFile,
  parseProjectJsonString,
  exportSheetToCSV,
} from './utils/projectStorage';

import {
  clockStamp,
  isCoilTab,
  isReadOnlyFunction,
  DEFAULT_DEFINITION,
  DEFAULT_SLAVE_CONFIG,
  PerTabState,
  INITIAL_TAB,
  createEmptyTabState,
  buildRowsForTab,
} from './utils/rowBuilder';
import { useTrendChart } from './hooks/useTrendChart';
import { runStudioDiagnostics } from './services/diagnostics';

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<TabSession[]>(() => {
    const saved = loadWorkspace();
    if (saved && saved.tabs && saved.tabs.length > 0) {
      if (saved.tabs.length === 1 && saved.tabs[0].id === 'tab-com3-slaves-airmeter') {
        return [INITIAL_TAB];
      }
      return saved.tabs;
    }
    return [INITIAL_TAB];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const saved = loadWorkspace();
    if (saved && saved.tabs && saved.tabs.length === 1 && saved.tabs[0].id === 'tab-com3-slaves-airmeter') {
      return INITIAL_TAB.id;
    }
    return saved ? saved.activeTabId : INITIAL_TAB.id;
  });
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-session independent runtime states
  const [tabStates, setTabStates] = useState<Record<string, PerTabState>>({
    [INITIAL_TAB.id]: createEmptyTabState(),
  });

  // UI display toggles
  const [showTraffic, setShowTraffic] = useState<boolean>(true);
  const [isProtocolAnalyzerOpen, setIsProtocolAnalyzerOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState<boolean>(false);
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
  const [currentView, setCurrentView] = useState<WorkspaceView>('registers');
  const [isSplitView, setIsSplitView] = useState<boolean>(false);
  const [splitTabId, setSplitTabId] = useState<string>('');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);

  // Multi-trace Realtime Trend Chart Hook
  const {
    chartTraces,
    traceData,
    isChartVisible,
    setIsChartVisible,
    handleToggleTrace,
    handleToggleTraceVisibility,
    handleRemoveTrace,
    handleMoveTrace,
    handleToggleTraceSpan,
    handleUpdateTraceLabel,
    handleClearAllChart,
    resetAllTraces,
    removeTracesForTab,
    ingestSamplePoints,
    activeChartColorMap,
    splitChartColorMap,
  } = useTrendChart(activeTabId, splitTabId, tabStates);

  // Quick Inspector Panel State
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [selectedRowAddress, setSelectedRowAddress] = useState<number | null>(null);

  // Handlers for hotkeys that are defined further down; assigned on every render.
  const hotkeyActionsRef = useRef<{ connectToggle: () => void; readOnce: () => void; definition: () => void } | null>(null);
  // Device actions (F3 connect/disconnect, F7 read, F8 definition) are ignored while a
  // full-screen analyzer or diagnostics view hides the workspace they act on.
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = currentView === 'analyzer' || isProtocolAnalyzerOpen || isDiagnosticsOpen;

  // Global Hotkeys: F1 (Help), F3 (Connect/Disconnect), F4 (Scanner), F7 (Read Once),
  // F8 (Definition), F9 (Mobile Remote), F10 (Classic Sniffer), F11 (Analyzer)
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
        setCurrentView((prev) => (prev === 'scanner' ? 'registers' : 'scanner'));
      } else if (e.key === 'F9') {
        e.preventDefault();
        setIsMobileModalOpen((prev) => !prev);
      } else if (e.key === 'F10') {
        e.preventDefault();
        setIsProtocolAnalyzerOpen((prev) => !prev);
      } else if (e.key === 'F11') {
        e.preventDefault();
        setCurrentView((prev) => (prev === 'analyzer' ? 'registers' : 'analyzer'));
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


  // Fetch available COM ports
  const refreshPorts = useCallback(async () => {
    try {
      const ports = await listSerialPorts();
      setAvailablePorts(ports);
      return ports;
    } catch (e) {
      console.warn('Could not list serial ports:', e);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshPorts();
    // Auto-detect when user switches back to the app after plugging in USB
    const handleFocus = () => refreshPorts();
    window.addEventListener('focus', handleFocus);
    // Periodic background scan every 3 seconds to auto-detect newly plugged USB devices
    const timer = setInterval(() => {
      refreshPorts();
    }, 3000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(timer);
    };
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
        const targetTab = tabsRef.current.find((t) => t.id === tabId) || activeTabRef.current;
        ingestSamplePoints(tabId, slice.values || [], slice.bool_values || [], startAddr, targetTab, timeStr, now.getTime());
      } catch (err) {
        console.error('Failed to load slave memory slice:', err);
      }
    },
    [updateTabState, ingestSamplePoints]
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
      if (isSuccess) {
        const targetTab = tabsRef.current.find((t) => t.id === targetId) || activeTabRef.current;
        const start = payload.start_address ?? targetTab.definition.start_address;
        ingestSamplePoints(targetId, payload.values, payload.bool_values, start, targetTab, timeStr, now.getTime());
      }
    },
    [updateTabState, ingestSamplePoints]
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
        // If it's an internal memory notification without HexRaw, we don't duplicate it in traffic log
        if (!act.hex_raw) {
          return {
            ...prev,
            slaveActivityCount: prev.slaveActivityCount + 1,
          };
        }

        const isResponse = act.is_write;
        const newEntry: TrafficEntry = {
          id: `slv-${Date.now()}-${Math.random()}`,
          timestamp: act.timestamp,
          direction: isResponse ? 'tx' : 'rx',
          description: `${act.client} -> ${act.summary}`,
          hex: act.hex_raw,
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

  const handleToggleSlaveServer = async (overrideCfg?: SlaveConfig) => {
    if (activeState.isListening) {
      await handleStopSlaveServer();
    } else {
      const cfg = overrideCfg || activeTab.slaveConfig || DEFAULT_SLAVE_CONFIG;
      await handleStartSlaveServer(cfg);
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
      role: activeTab.role,
      definition: {
        ...activeTab.definition,
      },
      format: activeTab.format,
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
    if (activeState.isConnected && activeState.connectionConfig && activeTab.role === 'master') {
      sessionConnect(newId, activeState.connectionConfig).catch(console.error);
      setTabStates((prev) => ({
        ...prev,
        [newId]: {
          ...createEmptyTabState(),
          isConnected: true,
          connectionConfig: activeState.connectionConfig,
        },
      }));
    } else {
      setTabStates((prev) => ({ ...prev, [newId]: createEmptyTabState() }));
    }
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
    removeTracesForTab(id);

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

  const applyImportedProject = async (imported: { tabs: TabSession[]; activeTabId: string; projectName: string }) => {
    for (const t of tabs) {
      try {
        await closeSession(t.id);
      } catch (err) {
        console.error(`Lỗi dọn dẹp session cũ ${t.id}:`, err);
      }
    }

    setTabStates({});
    resetAllTraces();
    setIsSplitView(false);
    setSplitTabId('');
    setTabs(imported.tabs);
    setActiveTabId(imported.activeTabId);
    notify('success', `Đã nạp dự án "${imported.projectName}" gồm ${imported.tabs.length} sheet.`);
  };

  // Attempt to load default project (e.g. COM3_Master_Slaves_Simulation.nxmodbus) on first mount if no saved project exists
  useEffect(() => {
    const tryAutoLoad = async () => {
      try {
        const saved = loadWorkspace();
        // If workspace was never saved or only has standard initial tab, load default project file
        if (!saved && (window as any).go?.main?.App?.LoadDefaultProject) {
          const content = await (window as any).go.main.App.LoadDefaultProject();
          if (content) {
            const imported = parseProjectJsonString(content);
            await applyImportedProject(imported);
          }
        }
      } catch (err) {
        console.warn('Auto-load default project skipped:', err);
      }
    };
    tryAutoLoad();
  }, []);

  const handleOpenProjectClick = async () => {
    // Try native Wails file dialog first if available
    try {
      if ((window as any).go?.main?.App?.OpenProjectFile) {
        const content = await (window as any).go.main.App.OpenProjectFile();
        if (content) {
          const imported = parseProjectJsonString(content);
          await applyImportedProject(imported);
          return;
        }
      }
    } catch (err) {
      console.warn('Native OpenProjectFile dialog canceled or failed:', err);
    }
    // Web fallback
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importProjectFromFile(file);
      await applyImportedProject(imported);
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

  const handleToggleDisabledAddr = async (tabId: string, address: number, disabled: boolean) => {
    const targetTab = tabsRef.current.find((t) => t.id === tabId);
    if (!targetTab || targetTab.role === 'slave') return;
    const set = new Set<number>(targetTab.definition.disabled_addrs || []);
    if (disabled) set.add(address);
    else set.delete(address);
    const nextDisabled = [...set].sort((a, b) => a - b);
    const nextDef: PollDefinition = {
      ...targetTab.definition,
      disabled_addrs: nextDisabled,
    };
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, definition: nextDef } : t))
    );
    const st = tabStates[tabId];
    if (st?.isPolling) {
      try {
        await sessionStopPolling(tabId);
        await sessionStartPolling(tabId, nextDef);
      } catch (err) {
        console.error('Lỗi cập nhật danh sách cấm đọc khi đang poll:', err);
      }
    }
  };

  const handleUpdateControl = (tabId: string, address: number, control: RegisterControlConfig) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const newControls = { ...(t.controls || {}) };
        if (!control || control.type === 'none') {
          delete newControls[address];
        } else {
          newControls[address] = control;
        }
        return { ...t, controls: newControls };
      })
    );
  };

  const handleApplyDeviceTemplate = (tpl: Partial<TabSession>, replaceTab: boolean) => {
    if (replaceTab) {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          return {
            ...t,
            title: tpl.title || t.title,
            role: tpl.role || t.role,
            definition: tpl.definition ? { ...t.definition, ...tpl.definition } : t.definition,
            format: tpl.format || t.format,
            formats: tpl.formats || {},
            aliases: tpl.aliases || {},
            units: tpl.units || {},
            scalings: tpl.scalings || {},
            controls: tpl.controls || {},
          };
        })
      );
      notify('success', `Đã nạp mẫu thiết bị "${tpl.title}" vào tab hiện tại!`);
    } else {
      const newId = `tab-${Date.now()}`;
      const newTab: TabSession = {
        id: newId,
        title: tpl.title || `Sheet ${tabs.length + 1}`,
        role: tpl.role || 'master',
        definition: tpl.definition ? { ...DEFAULT_DEFINITION, ...tpl.definition } : { ...DEFAULT_DEFINITION },
        format: tpl.format || 'unsigned16',
        formats: tpl.formats || {},
        aliases: tpl.aliases || {},
        units: tpl.units || {},
        scalings: tpl.scalings || {},
        controls: tpl.controls || {},
        slaveTable: 'holding',
        slaveStartAddr: 0,
        slaveQuantity: 20,
      };
      setTabs((prev) => [...prev, newTab]);
      setTabStates((prev) => ({ ...prev, [newId]: createEmptyTabState() }));
      setActiveTabId(newId);
      notify('success', `Đã tạo tab mới từ mẫu "${tpl.title}"!`);
    }
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

  overlayOpenRef.current = isProtocolAnalyzerOpen || currentView === 'analyzer' || isDiagnosticsOpen;
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
    handleToggleDisabledAddr,
    handleInlineWriteForTab,
    handleToggleCoilForTab,
    handleToggleTrace,
  });
  gridHandlersRef.current = {
    handleUpdateAlias,
    handleUpdateUnit,
    handleUpdateScaling,
    handleUpdateFormat,
    handleToggleDisabledAddr,
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
      onToggleDisabledAddr: (addr: number, dis: boolean) => h().handleToggleDisabledAddr(tabId, addr, dis),
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

  // Determine which tab is targeted by the Write Modal
  const modalTab = selectedTabForWrite || activeTab;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Hidden File Input for Project Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".nxmodbus,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 1. TOP QUICK CONTROL BAR (All-in-one 1-click connect, polling, telemetry & view controls) */}
      <TopQuickBar
        activeTab={activeTab}
        onRoleChange={handleRoleChange}
        isConnected={activeState.isConnected}
        connectionConfig={activeState.connectionConfig}
        availablePorts={availablePorts}
        onRefreshPorts={refreshPorts}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onOpenAdvancedConnection={() => setIsConnectionModalOpen(true)}
        isPolling={activeState.isPolling}
        onTogglePoll={handleTogglePoll}
        onReadOnce={handleReadOnce}
        onSaveDefinition={handleSaveDefinition}
        onOpenAdvancedDefinition={() => setIsDefinitionModalOpen(true)}
        isListening={activeState.isListening}
        onToggleSlaveServer={handleToggleSlaveServer}
        onOpenSlaveSetup={() => setIsSlaveModalOpen(true)}
        onTableChange={handleSlaveTableChange}
        txCount={activeState.txCount}
        errCount={activeState.errCount}
        latencyMs={activeState.latencyMs}
        onClearCounters={() => {
          sessionResetCounters(activeTab.id).catch((err) => console.error('Reset counters failed:', err));
          updateTabState(activeTab.id, (prev) => ({ ...prev, txCount: 0, errCount: 0 }));
        }}
        format={activeTab.format}
        onFormatChange={(fmt) =>
          setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, format: fmt } : t)))
        }
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector(!showInspector)}
        showTraffic={showTraffic}
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        isSplitView={isSplitView}
        onToggleSplitView={handleToggleSplitView}
      />

      {/* 2. MAIN WORKSPACE CONTAINER */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side Navigation Dock */}
        <SidebarDock
          activeView={currentView}
          onSelectView={(view) => {
            if (view === 'slave' && activeTab.role !== 'slave') {
              const existingSlave = tabs.find((t) => t.role === 'slave');
              if (existingSlave) {
                setActiveTabId(existingSlave.id);
              } else {
                handleRoleChange('slave');
              }
            }
            setCurrentView(view);
          }}
          onOpenMobileRemote={() => setIsMobileModalOpen(true)}
          onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
          onOpenHelp={() => setIsHelpModalOpen(true)}
          onOpenNewTab={handleAddTab}
          onSaveProject={handleSaveProject}
          onOpenProject={handleOpenProjectClick}
          onExportCSV={handleExportCSV}
          onOpenTemplates={() => setIsTemplatesModalOpen(true)}
          onOpenNewInstance={() => openNewInstance()}
          isPolling={activeState.isPolling}
          slaveRunning={activeState.isListening}
        />

        {/* Center / Right Content Views */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-slate-950">
          {/* VIEW: REGISTERS & DATA GRID */}
          {currentView === 'registers' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSelectTab={setActiveTabId}
                onCloseTab={handleCloseTab}
                onAddTab={handleAddTab}
                onRenameTab={handleRenameTab}
              />

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
                    onUpdateControl={(addr, ctrl) => handleUpdateControl(activeTab.id, addr, ctrl)}
                    onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
                    onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
                    onOpenChart={(row) => handleToggleTrace(activeTab, row)}
                    isTracing={isInspectorRowTracing}
                  />
                )}
              </div>

              {/* Realtime Multi-Trace Trend Chart Drawer */}
              {chartTraces.length > 0 && isChartVisible && (
                <TrendChart
                  traces={chartTraces}
                  traceData={traceData}
                  onToggleTraceVisibility={handleToggleTraceVisibility}
                  onRemoveTrace={handleRemoveTrace}
                  onMoveTrace={handleMoveTrace}
                  onToggleTraceSpan={handleToggleTraceSpan}
                  onRenameTrace={(trace, newLabel) => {
                    handleUpdateTraceLabel(trace.id, newLabel);
                    handleUpdateAlias(trace.tabId, trace.address, newLabel);
                  }}
                  onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
                  onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
                  isCoil={activeRowsObj.isCoil}
                  onClear={handleClearAllChart}
                  onClose={() => setIsChartVisible(false)}
                  availableRows={activeRowsObj.rows}
                  onAddTrace={(row) => handleToggleTrace(activeTab, row)}
                />
              )}

              {/* Communication Traffic Box */}
              {showTraffic && (
                <TrafficBox
                  entries={activeState.traffic}
                  onClear={() => updateTabState(activeTab.id, (prev) => ({ ...prev, traffic: [] }))}
                  onOpenAnalyzer={() => setCurrentView('analyzer')}
                />
              )}

              {/* Status Bar */}
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

          {/* VIEW: SCANNER & DISCOVERY */}
          {currentView === 'scanner' && (
            <ScannerView
              activeSession={activeTab}
              onApplySlaveId={handleApplySlaveId}
              onApplyConnection={handleApplyScannerConnection}
              onApplyRange={handleApplyScannerRange}
              onReturnToRegisters={() => setCurrentView('registers')}
            />
          )}

          {/* VIEW: TREND CHARTS FULLSCREEN */}
          {currentView === 'charts' && (
            <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
              <TrendChart
                traces={chartTraces}
                traceData={traceData}
                onToggleTraceVisibility={handleToggleTraceVisibility}
                onRemoveTrace={handleRemoveTrace}
                onMoveTrace={handleMoveTrace}
                onToggleTraceSpan={handleToggleTraceSpan}
                onRenameTrace={(trace, newLabel) => {
                  handleUpdateTraceLabel(trace.id, newLabel);
                  handleUpdateAlias(trace.tabId, trace.address, newLabel);
                }}
                onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
                onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
                isCoil={activeRowsObj.isCoil}
                onClear={handleClearAllChart}
                onClose={() => setCurrentView('registers')}
                isFullScreen
                availableRows={activeRowsObj.rows}
                onAddTrace={(row) => handleToggleTrace(activeTab, row)}
              />
            </div>
          )}

          {/* VIEW: PROTOCOL ANALYZER */}
          {currentView === 'analyzer' && (
            <div className="flex-1 h-full overflow-hidden">
              <AnalyzerStudio
                isOpen={true}
                onClose={() => setCurrentView('registers')}
                onOpenClassic={() => {
                  setIsProtocolAnalyzerOpen(true);
                }}
              />
            </div>
          )}

          {/* VIEW: RAW SERIAL & TTL TERMINAL */}
          {currentView === 'rawserial' && (
            <div className="flex-1 h-full overflow-hidden">
              <RawSerialStudio onClose={() => setCurrentView('registers')} />
            </div>
          )}

          {/* VIEW: MODBUS GATEWAY BRIDGE */}
          {currentView === 'gateway' && (
            <div className="flex-1 h-full overflow-hidden">
              <GatewayBridgeStudio onClose={() => setCurrentView('registers')} />
            </div>
          )}

          {/* VIEW: OVERNIGHT DATALOGGER */}
          {currentView === 'datalogger' && (
            <div className="flex-1 h-full overflow-hidden">
              <DataloggerStudio
                activeRows={activeRowsObj.rows}
                activeTab={activeTab}
                onClose={() => setCurrentView('registers')}
              />
            </div>
          )}

          {/* VIEW: AUTO-SCRIPTING MACRO RUNNER */}
          {currentView === 'macro' && (
            <div className="flex-1 h-full overflow-hidden">
              <MacroRunnerStudio
                activeTab={activeTab}
                onExecuteWriteRegister={async (addr, val) => {
                  const err = await performWrite(activeTab.id, addr, String(val));
                  return !err;
                }}
                onExecuteWriteCoil={async (addr, val) => {
                  const err = await performWrite(activeTab.id, addr, val ? '1' : '0');
                  return !err;
                }}
                onExecuteReadValue={async (addr) => {
                  const row = activeRowsObj.rows.find((r) => r.address === addr);
                  if (!row) return null;
                  if (typeof row.rawValue === 'number') return row.rawValue;
                  const parsed = parseFloat(String(row.displayValue).replace(/,/g, ''));
                  return isNaN(parsed) ? null : parsed;
                }}
                onClose={() => setCurrentView('registers')}
              />
            </div>
          )}

          {/* VIEW: SLAVE WORKSTATION */}
          {currentView === 'slave' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSelectTab={setActiveTabId}
                onCloseTab={handleCloseTab}
                onAddTab={handleAddTab}
                onRenameTab={handleRenameTab}
              />

              <div className="flex-1 flex min-h-0 overflow-hidden">
                <DataGrid
                  rows={activeRowsObj.rows}
                  isCoil={activeRowsObj.isCoil}
                  sheetFormat={activeTab.format}
                  selectedAddress={inspectorSelectedRow?.address}
                  onSelectRow={(row) => setSelectedRowAddress(row.address)}
                  {...activeGridHandlers}
                  activeChartColorMap={activeChartColorMap}
                />
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
                    onUpdateControl={(addr, ctrl) => handleUpdateControl(activeTab.id, addr, ctrl)}
                    onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
                    onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
                    onOpenChart={(row) => handleToggleTrace(activeTab, row)}
                    isTracing={isInspectorRowTracing}
                  />
                )}
              </div>

              {showTraffic && (
                <TrafficBox
                  entries={activeState.traffic}
                  onClear={() => updateTabState(activeTab.id, (prev) => ({ ...prev, traffic: [] }))}
                  onOpenAnalyzer={() => setCurrentView('analyzer')}
                />
              )}

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
        </main>
      </div>

      {/* Classic Sniffer Modal fallback */}
      <Suspense fallback={null}>
        {isProtocolAnalyzerOpen && (
          <ProtocolAnalyzer isOpen onClose={() => setIsProtocolAnalyzerOpen(false)} />
        )}
      </Suspense>

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

      {/* 6. Device Templates & JSON Profile Modal */}
      <DeviceTemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        activeTab={activeTab}
        onApplyTemplate={handleApplyDeviceTemplate}
        onImportProfile={(imported) => handleApplyDeviceTemplate(imported, true)}
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
