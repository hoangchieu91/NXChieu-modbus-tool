import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  listSerialPorts,
  sessionConnect,
  sessionDisconnect,
  sessionStartPolling,
  sessionStopPolling,
  sessionReadOnce,
  sessionWriteRegister,
  sessionWriteCoil,
  slaveStart,
  slaveStop,
  slaveGetSlice,
  slaveSetRegister,
  slaveSetCoil,
  slaveStartSim,
  slaveStopSim,
  subscribePollData,
  subscribeSlaveActivity,
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


import {
  ChartDataPoint,
  ChartTrace,
  ConnectionConfig,
  DataFormat,
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
import { formatValue, getModbusAddressLabel } from './utils/formatters';
import {
  loadWorkspace,
  saveWorkspace,
  exportProjectToFile,
  importProjectFromFile,
  exportSheetToCSV,
} from './utils/projectStorage';

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
  const [isSplitView, setIsSplitView] = useState<boolean>(false);
  const [splitTabId, setSplitTabId] = useState<string>('');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);

  // Multi-trace Realtime Trend Chart State
  const [chartTraces, setChartTraces] = useState<ChartTrace[]>([]);
  const [traceData, setTraceData] = useState<Record<string, ChartDataPoint[]>>({});
  const [isChartVisible, setIsChartVisible] = useState<boolean>(false);

  const TRACE_PALETTE = useMemo(
    () => ['#22d3ee', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#38bdf8', '#eab308', '#ec4899'],
    []
  );

  // Global Hotkeys: F1 (Help), F4 (Scanner)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setIsHelpModalOpen((prev) => !prev);
      } else if (e.key === 'F4') {
        e.preventDefault();
        setIsScannerModalOpen((prev) => !prev);
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
        const slice = await slaveGetSlice(tabId, table, startAddr, qty);
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');

        updateTabState(tabId, (prev) => {
          const updatedMap = { ...(prev.lastUpdatedMap || {}) };
          const count = slice.values?.length || slice.bool_values?.length || 0;
          for (let i = 0; i < count; i++) {
            updatedMap[startAddr + i] = timeStr;
          }

          return {
            ...prev,
            hasData: true,
            regs: slice.values || [],
            coils: slice.bool_values || [],
            lastUpdatedTime: timeStr,
            lastUpdatedMap: updatedMap,
          };
        });

        // Record point for any chart trace matching this tab
        if (slice.values && chartTracesRef.current.length > 0) {
          const targetTab = tabsRef.current.find((t) => t.id === tabId) || activeTabRef.current;
          chartTracesRef.current.forEach((trace) => {
            if (trace.tabId === tabId) {
              const relIdx = trace.address - startAddr;
              if (relIdx >= 0 && slice.values && relIdx < slice.values.length) {
                const regFmt = targetTab.formats?.[trace.address] || targetTab.format;
                const scaling = targetTab.scalings[trace.address] ?? 1;
                const fmtRes = formatValue(slice.values, relIdx, regFmt, scaling);
                const parsed = parseFloat(fmtRes.display.replace(/,/g, ''));
                const val = isNaN(parsed) ? slice.values[relIdx] * scaling : parsed;

                setTraceData((prev) => ({
                  ...prev,
                  [trace.id]: [
                    ...(prev[trace.id] || []).slice(-299),
                    { timestamp: timeStr, timeMs: now.getTime(), value: val },
                  ],
                }));
              }
            }
          });
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

  // Subscribe to Master Poll-Data Events
  useEffect(() => {
    const unbind = subscribePollData((payload) => {
      const targetId = payload.session_id || activeTabRef.current.id;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');

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
        if (payload.raw_rx) {
          newEntries.push({
            id: `rx-${Date.now()}-${Math.random()}`,
            timestamp: payload.timestamp,
            direction: payload.error ? 'err' : 'rx',
            hex: payload.error ? `Error: ${payload.error}` : payload.raw_rx,
          });
        }

        const isSuccess = !payload.error && (payload.values.length > 0 || payload.bool_values.length > 0);
        const updatedMap = { ...(prev.lastUpdatedMap || {}) };
        if (isSuccess) {
          const targetTab = tabsRef.current.find((t) => t.id === targetId) || activeTabRef.current;
          const start = targetTab.definition.start_address;
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
          hasData: isSuccess,
          regs: isSuccess ? payload.values : [],
          coils: isSuccess ? payload.bool_values : [],
          lastValues: payload.is_coil ? prev.coils : prev.regs,
          lastUpdatedTime: isSuccess ? timeStr : prev.lastUpdatedTime,
          lastUpdatedMap: updatedMap,
          traffic: [...prev.traffic, ...newEntries].slice(-500),
        };
      });

      // Record point for any chart trace matching this tab
      const isSuccess = !payload.error && payload.values && payload.values.length > 0;
      if (isSuccess && chartTracesRef.current.length > 0) {
        const targetTab = tabsRef.current.find((t) => t.id === targetId) || activeTabRef.current;
        const start = targetTab.definition.start_address;

        chartTracesRef.current.forEach((trace) => {
          if (trace.tabId === targetId) {
            const relIdx = trace.address - start;
            if (relIdx >= 0 && relIdx < payload.values.length) {
              const regFmt = targetTab.formats?.[trace.address] || targetTab.format;
              const scaling = targetTab.scalings[trace.address] ?? 1;
              const fmtRes = formatValue(payload.values, relIdx, regFmt, scaling);
              const parsed = parseFloat(fmtRes.display.replace(/,/g, ''));
              const val = isNaN(parsed) ? payload.values[relIdx] * scaling : parsed;

              setTraceData((prev) => ({
                ...prev,
                [trace.id]: [
                  ...(prev[trace.id] || []).slice(-299),
                  { timestamp: timeStr, timeMs: now.getTime(), value: val },
                ],
              }));
            }
          }
        });
      }
    });

    return () => unbind();
  }, [updateTabState]);

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

      // Synchronize memory table with latest changes
      const currentTab = activeTabRef.current;
      if (currentTab.id === targetId) {
        refreshSlaveSlice(currentTab.id, currentTab.slaveTable, currentTab.slaveStartAddr, currentTab.slaveQuantity);
      }
    });

    return () => unbind();
  }, [updateTabState, refreshSlaveSlice]);

  // --- Master Connection Handlers ---

  const handleConnect = async (cfg: ConnectionConfig) => {
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
    } catch (err) {
      alert(`Kết nối thất bại: ${err}`);
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
      } else {
        await sessionStartPolling(activeTab.id, activeTab.definition);
        updateTabState(activeTab.id, (prev) => ({ ...prev, isPolling: true }));
      }
    } catch (err) {
      alert(`Lỗi Polling: ${err}`);
    }
  };

  const handleReadOnce = async () => {
    if (!activeState.isConnected || activeState.isPolling) return;
    try {
      const res = await sessionReadOnce(activeTab.id, activeTab.definition);
      updateTabState(activeTab.id, (prev) => {
        const isSuccess = !res.error && (res.values.length > 0 || res.bool_values.length > 0);
        return {
          ...prev,
          txCount: res.tx_count,
          errCount: res.err_count,
          latencyMs: res.latency_ms,
          hasData: isSuccess,
          regs: isSuccess ? res.values : [],
          coils: isSuccess ? res.bool_values : [],
        };
      });
    } catch (err) {
      alert(`Lỗi đọc: ${err}`);
    }
  };

  // --- Slave Handlers ---

  const handleStartSlaveServer = async (cfg: SlaveConfig) => {
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
    } catch (err) {
      alert(`Khởi động Slave Server thất bại: ${err}`);
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
    } catch (err) {
      alert(`Lỗi kích hoạt mô phỏng: ${err}`);
    }
  };

  const handleStopSimulation = async () => {
    try {
      await slaveStopSim(activeTab.id);
      updateTabState(activeTab.id, (prev) => ({ ...prev, isSimulating: false }));
    } catch (err) {
      console.error(err);
    }
  };

  // Switch role between Master & Slave
  const handleRoleChange = (role: SessionRole) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, role } : t))
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

  const handleApplySlaveId = (slaveId: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, definition: { ...t.definition, slave_id: slaveId } }
          : t
      )
    );
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

  const handleApplyScannerRange = (fc: number, startAddr: number, qty: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              definition: {
                ...t.definition,
                function_code: fc,
                start_address: startAddr,
                quantity: Math.min(100, Math.max(1, qty)),
              },
            }
          : t
      )
    );
  };

  // --- Inline Write & Coil Toggle Handlers ---


  const handleInlineWriteForTab = async (tabId: string, address: number, valueStr: string) => {
    const targetTab = tabs.find((t) => t.id === tabId) || activeTab;
    try {
      let num = 0;
      const trimmed = valueStr.trim();
      if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
        num = parseInt(trimmed, 16);
      } else {
        const parsedFloat = parseFloat(trimmed);
        if (isNaN(parsedFloat)) return;
        const scaling = targetTab.scalings[address] ?? 1;
        if (scaling !== 1 && scaling !== 0) {
          num = Math.round(parsedFloat / scaling);
        } else {
          num = Math.round(parsedFloat);
        }
      }
      if (num < 0) num = 0;
      if (num > 65535) num = 65535;

      if (targetTab.role === 'slave') {
        const isCoilType = targetTab.slaveTable === 'coils' || targetTab.slaveTable === 'discrete';
        if (isCoilType) {
          await slaveSetCoil(targetTab.id, targetTab.slaveTable, address, num > 0);
        } else {
          await slaveSetRegister(targetTab.id, targetTab.slaveTable, address, num);
        }
        await refreshSlaveSlice(targetTab.id, targetTab.slaveTable, targetTab.slaveStartAddr, targetTab.slaveQuantity);
      } else {
        await sessionWriteRegister(targetTab.id, {
          slave_id: targetTab.definition.slave_id,
          address,
          value: num,
        });
      }
    } catch (err) {
      alert(`Lỗi ghi thanh ghi: ${err}`);
    }
  };

  const handleToggleCoilForTab = async (tabId: string, address: number, currentVal: boolean) => {
    const targetTab = tabs.find((t) => t.id === tabId) || activeTab;
    try {
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
      alert(`Lỗi chuyển trạng thái Coil: ${err}`);
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
        port_tcp: 5020 + tabs.length,
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

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0].id);
    }
    if (splitTabId === id) {
      const nextSplit = remaining.find((t) => t.id !== (activeTabId === id ? remaining[0].id : activeTabId));
      setSplitTabId(nextSplit ? nextSplit.id : '');
    }
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
      const imported = await importProjectFromFile(file);
      setTabs(imported.tabs);
      setActiveTabId(imported.activeTabId);
      alert(`Đã nạp thành công dự án "${imported.projectName}" gồm ${imported.tabs.length} Sheet!`);
    } catch (err) {
      alert(`Lỗi nạp file dự án: ${err}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // --- Cell Metadata Updaters ---

  const handleUpdateAlias = (tabId: string, address: number, alias: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, aliases: { ...t.aliases, [address]: alias } } : t
      )
    );
  };

  const handleUpdateUnit = (tabId: string, address: number, unit: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, units: { ...t.units, [address]: unit } } : t
      )
    );
  };

  const handleUpdateScaling = (tabId: string, address: number, scaling: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, scalings: { ...t.scalings, [address]: scaling } } : t
      )
    );
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
      const nextColor = TRACE_PALETTE[chartTraces.length % TRACE_PALETTE.length];
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
      if (row.hasValue && typeof row.rawValue === 'number') {
        const timeNow = new Date();
        const timeStr = timeNow.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(timeNow.getMilliseconds()).padStart(3, '0');
        const parsed = parseFloat(row.displayValue.replace(/,/g, ''));
        const val = isNaN(parsed) ? Number(row.rawValue) : parsed;
        setTraceData((prev) => ({
          ...prev,
          [traceId]: [{ timestamp: timeStr, timeMs: timeNow.getTime(), value: val }],
        }));
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

  // --- Grid Row Construction Helper ---

  const buildRowsForTab = (tab: TabSession, state: PerTabState): { rows: RegisterRow[]; isCoil: boolean } => {
    const isCoil =
      tab.role === 'slave'
        ? tab.slaveTable === 'coils' || tab.slaveTable === 'discrete'
        : tab.definition.function_code === 1 || tab.definition.function_code === 2;

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
            cellHasValue = true;
          }
        }
      }

      let displayAddress = '';
      if (tab.role === 'slave') {
        const prefix =
          tab.slaveTable === 'holding'
            ? '4'
            : tab.slaveTable === 'input'
            ? '3'
            : tab.slaveTable === 'discrete'
            ? '1'
            : '0';
        displayAddress = `${prefix}${String(addr + 1).padStart(4, '0')} (${addr})`;
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
        hasValue: cellHasValue,
      });
    }

    return { rows: resultRows, isCoil };
  };

  const activeRowsObj = buildRowsForTab(activeTab, activeState);

  // Compute split tab & rows if Split View is active
  const splitTab =
    tabs.find((t) => t.id === splitTabId) ||
    tabs.find((t) => t.id !== activeTabId) ||
    activeTab;
  const splitState = tabStates[splitTab.id] || createEmptyTabState();
  const splitRowsObj = buildRowsForTab(splitTab, splitState);

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

  // Determine which tab is targeted by the Write Modal
  const modalTab = selectedTabForWrite || activeTab;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Hidden File Input for Project Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".nxmodbus,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 1. Menu Bar */}
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
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        showTraffic={showTraffic}
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
        onOpenHelp={() => setIsHelpModalOpen(true)}
        onOpenScanner={() => setIsScannerModalOpen(true)}
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
        onClearCounters={() =>
          updateTabState(activeTab.id, (prev) => ({ ...prev, txCount: 0, errCount: 0 }))
        }
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

      {/* 4. Main Data Grid Viewport (Single View or Split Dual View) */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!isSplitView ? (
          <DataGrid
            rows={activeRowsObj.rows}
            isCoil={activeRowsObj.isCoil}
            sheetFormat={activeTab.format}
            onRowDoubleClick={(row) => {
              setSelectedRowForWrite(row);
              setSelectedTabForWrite(activeTab);
              setIsWriteModalOpen(true);
            }}
            onUpdateAlias={(addr, val) => handleUpdateAlias(activeTab.id, addr, val)}
            onUpdateUnit={(addr, val) => handleUpdateUnit(activeTab.id, addr, val)}
            onUpdateScaling={(addr, val) => handleUpdateScaling(activeTab.id, addr, val)}
            onUpdateFormat={(addr, fmt) => handleUpdateFormat(activeTab.id, addr, fmt)}
            onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
            onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
            onOpenChart={(row) => handleToggleTrace(activeTab, row)}
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
                onRowDoubleClick={(row) => {
                  setSelectedRowForWrite(row);
                  setSelectedTabForWrite(activeTab);
                  setIsWriteModalOpen(true);
                }}
                onUpdateAlias={(addr, val) => handleUpdateAlias(activeTab.id, addr, val)}
                onUpdateUnit={(addr, val) => handleUpdateUnit(activeTab.id, addr, val)}
                onUpdateScaling={(addr, val) => handleUpdateScaling(activeTab.id, addr, val)}
                onUpdateFormat={(addr, fmt) => handleUpdateFormat(activeTab.id, addr, fmt)}
                onInlineWrite={(addr, val) => handleInlineWriteForTab(activeTab.id, addr, val)}
                onToggleCoil={(addr, cur) => handleToggleCoilForTab(activeTab.id, addr, cur)}
                onOpenChart={(row) => handleToggleTrace(activeTab, row)}
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
                onRowDoubleClick={(row) => {
                  setSelectedRowForWrite(row);
                  setSelectedTabForWrite(splitTab);
                  setIsWriteModalOpen(true);
                }}
                onUpdateAlias={(addr, val) => handleUpdateAlias(splitTab.id, addr, val)}
                onUpdateUnit={(addr, val) => handleUpdateUnit(splitTab.id, addr, val)}
                onUpdateScaling={(addr, val) => handleUpdateScaling(splitTab.id, addr, val)}
                onUpdateFormat={(addr, fmt) => handleUpdateFormat(splitTab.id, addr, fmt)}
                onInlineWrite={(addr, val) => handleInlineWriteForTab(splitTab.id, addr, val)}
                onToggleCoil={(addr, cur) => handleToggleCoilForTab(splitTab.id, addr, cur)}
                onOpenChart={(row) => handleToggleTrace(splitTab, row)}
                activeChartColorMap={splitChartColorMap}
              />
            </div>
          </div>
        )}

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
        onSave={(newDef) => {
          setTabs((prev) =>
            prev.map((t) => (t.id === activeTabId ? { ...t, definition: newDef } : t))
          );
        }}
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
        isCoil={
          selectedRowForWrite
            ? modalTab.role === 'slave'
              ? modalTab.slaveTable === 'coils' || modalTab.slaveTable === 'discrete'
              : modalTab.definition.function_code === 1 || modalTab.definition.function_code === 2
            : false
        }
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
    </div>

  );
};

export default App;
