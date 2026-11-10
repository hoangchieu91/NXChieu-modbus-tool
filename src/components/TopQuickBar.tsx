import React, { useState, useEffect, useRef } from 'react';
import {
  Unplug,
  Play,
  Pause,
  RotateCcw,
  Radio,
  Server,
  Square,
  Settings,
  RefreshCw,
  Sliders,
  Zap,
  Columns,
  Binary,
  Terminal,
  PanelRight,
  Copy,
} from 'lucide-react';
import { openNewInstance } from '../services/backend';
import {
  ConnectionConfig,
  DataFormat,
  PollDefinition,
  SerialPortDetail,
  SessionRole,
  SlaveConfig,
  SlaveTable,
  TabSession,
} from '../types/modbus';

interface TopQuickBarProps {
  activeTab: TabSession;
  onRoleChange: (role: SessionRole) => void;
  // Connection props
  isConnected: boolean;
  connectionConfig: ConnectionConfig | null;
  availablePorts: SerialPortDetail[];
  onRefreshPorts: () => void;
  onConnect: (config: ConnectionConfig) => Promise<boolean>;
  onDisconnect: () => void;
  onOpenAdvancedConnection: () => void;
  // Poller props (Master)
  isPolling: boolean;
  onTogglePoll: () => void;
  onReadOnce: () => void;
  onSaveDefinition: (def: PollDefinition) => void;
  onOpenAdvancedDefinition: () => void;
  // Slave props
  isListening: boolean;
  onToggleSlaveServer: (overrideCfg?: SlaveConfig) => void;
  onOpenSlaveSetup: () => void;
  onTableChange: (table: SlaveTable) => void;
  // Metrics
  txCount: number;
  errCount: number;
  latencyMs: number;
  onClearCounters: () => void;
  // View & Format toggles
  format?: DataFormat;
  onFormatChange?: (fmt: DataFormat) => void;
  showInspector?: boolean;
  onToggleInspector?: () => void;
  showTraffic?: boolean;
  onToggleTraffic?: () => void;
  isSplitView?: boolean;
  onToggleSplitView?: () => void;
}

export function formatPortLabel(p: SerialPortDetail): string {
  if (!p.description) return p.port_name;
  // If description has "Ch A" / "Ch B" / "Channel A", extract it cleanly
  const chMatch = p.description.match(/Ch(?:annel)?\s*([A-H0-9]+)/i);
  if (chMatch) {
    return `${p.port_name} (Kênh ${chMatch[1].toUpperCase()})`;
  }
  const clean = p.description.replace(new RegExp(`\\(?${p.port_name}\\)?`, 'gi'), '').trim();
  if (clean) {
    return `${p.port_name} (${clean.slice(0, 18)})`;
  }
  return p.port_name;
}

export function sortSerialPorts(ports: SerialPortDetail[]): SerialPortDetail[] {
  return [...ports].sort((a, b) => {
    const matchA = (a.description || '').match(/Ch(?:annel)?\s*([A-H0-9]+)/i);
    const matchB = (b.description || '').match(/Ch(?:annel)?\s*([A-H0-9]+)/i);
    if (matchA && matchB) {
      return matchA[1].localeCompare(matchB[1]);
    }
    if (matchA && !matchB) return -1;
    if (!matchA && matchB) return 1;
    const numA = parseInt(a.port_name.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.port_name.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });
}

export const TopQuickBar: React.FC<TopQuickBarProps> = ({
  activeTab,
  onRoleChange,
  isConnected,
  connectionConfig,
  availablePorts,
  onRefreshPorts,
  onConnect,
  onDisconnect,
  onOpenAdvancedConnection,
  isPolling,
  onTogglePoll,
  onReadOnce,
  onSaveDefinition,
  onOpenAdvancedDefinition,
  isListening,
  onToggleSlaveServer,
  onOpenSlaveSetup,
  onTableChange,
  txCount,
  errCount,
  latencyMs,
  onClearCounters,
  format,
  onFormatChange,
  showInspector,
  onToggleInspector,
  showTraffic,
  onToggleTraffic,
  isSplitView,
  onToggleSplitView,
}) => {
  // Local drafted state for quick 1-click connect
  const [connType, setConnType] = useState<'serial' | 'tcp' | 'simulator'>('serial');
  const [port, setPort] = useState<string>('COM1');
  const [baudRate, setBaudRate] = useState<number>(19200);
  const [parity, setParity] = useState<string>('none');
  const [stopBits, setStopBits] = useState<number>(1);
  const [tcpHost, setTcpHost] = useState<string>('127.0.0.1');
  const [tcpPort, setTcpPort] = useState<number>(502);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync draft connection with runtime connection if active or with slaveConfig if role is slave
  useEffect(() => {
    if (activeTab.role === 'slave') {
      const sc = activeTab.slaveConfig;
      if (sc) {
        if (sc.type === 'tcp') {
          setConnType('tcp');
          if (sc.host) setTcpHost(sc.host);
          if (sc.port_tcp) setTcpPort(sc.port_tcp);
        } else {
          setConnType('serial');
          if (sc.port) setPort(sc.port);
          if (sc.baud_rate) setBaudRate(sc.baud_rate);
          if (sc.parity) setParity(sc.parity);
          if (sc.stop_bits) setStopBits(sc.stop_bits);
        }
      }
    } else {
      if (connectionConfig) {
        if (connectionConfig.type === 'serial') {
          if (connectionConfig.port.toLowerCase() === 'simulator') {
            setConnType('simulator');
          } else {
            setConnType('serial');
            setPort(connectionConfig.port);
            setBaudRate(connectionConfig.baud_rate);
            setParity(connectionConfig.parity);
            setStopBits(connectionConfig.stop_bits || 1);
          }
        } else if (connectionConfig.type === 'tcp') {
          setConnType('tcp');
          setTcpHost(connectionConfig.host);
          setTcpPort(connectionConfig.port);
        }
      }
    }
  }, [activeTab.role, activeTab.id, activeTab.slaveConfig, connectionConfig]);

  // Auto-detect & auto-select newly plugged USB COM ports
  const prevPortsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentPortNames = availablePorts.map((p) => p.port_name);
    // Find newly added ports
    const newlyAdded = currentPortNames.filter((name) => !prevPortsRef.current.includes(name));
    prevPortsRef.current = currentPortNames;

    if (newlyAdded.length > 0 && !isConnected && !isListening) {
      // Auto select the newly plugged USB port!
      setPort(newlyAdded[newlyAdded.length - 1]);
    } else if (availablePorts.length > 0 && !availablePorts.some((p) => p.port_name === port)) {
      setPort(availablePorts[0].port_name);
    }
  }, [availablePorts, isConnected, isListening, port]);

  // Definition draft state (Master)
  const def = activeTab.definition;
  const [slaveId, setSlaveId] = useState<number>(def.slave_id);
  const [fc, setFc] = useState<number>(def.function_code);
  const [startAddrInput, setStartAddrInput] = useState<string>(String(def.start_address));
  const [quantity, setQuantity] = useState<number>(def.quantity);

  useEffect(() => {
    setSlaveId(def.slave_id);
    setFc(def.function_code);
    setStartAddrInput(String(def.start_address));
    setQuantity(def.quantity);
  }, [def]);

  const commitDefinition = (overrides?: Partial<PollDefinition>) => {
    let addr = 0;
    const cleanStr = startAddrInput.trim().toLowerCase();
    if (cleanStr.startsWith('0x')) {
      addr = parseInt(cleanStr, 16);
    } else {
      addr = parseInt(cleanStr, 10);
    }
    if (isNaN(addr) || addr < 0) addr = 0;

    const newDef: PollDefinition = {
      ...def,
      slave_id: slaveId,
      function_code: fc,
      start_address: addr,
      quantity: Math.max(1, Math.min(250, quantity)),
      ...overrides,
    };
    onSaveDefinition(newDef);
  };

  const handleToggleSlave = () => {
    if (isListening) {
      onToggleSlaveServer();
    } else {
      const slaveCfg: SlaveConfig = {
        type: connType === 'tcp' ? 'tcp' : 'serial',
        port,
        baud_rate: baudRate,
        data_bits: 8,
        parity,
        stop_bits: stopBits,
        host: tcpHost.trim() || '0.0.0.0',
        port_tcp: tcpPort || 5020,
        slave_id: slaveId || activeTab.slaveConfig?.slave_id || 1,
        slave_id_end: activeTab.slaveConfig?.slave_id_end || (slaveId || 1),
      };
      onToggleSlaveServer(slaveCfg);
    }
  };

  const handleQuickConnect = async () => {
    if (isConnected) {
      onDisconnect();
      return;
    }

    setIsConnecting(true);
    let cfg: ConnectionConfig;
    if (connType === 'simulator') {
      cfg = {
        type: 'serial',
        port: 'simulator',
        baud_rate: 19200,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        timeout_ms: 1000,
      };
    } else if (connType === 'tcp') {
      cfg = {
        type: 'tcp',
        host: tcpHost.trim() || '127.0.0.1',
        port: tcpPort || 502,
        timeout_ms: 1000,
      };
    } else {
      cfg = {
        type: 'serial',
        port,
        baud_rate: baudRate,
        data_bits: 8,
        parity,
        stop_bits: stopBits,
        timeout_ms: 1000,
      };
    }

    try {
      await onConnect(cfg);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center justify-between border-b border-white/[.08] bg-[#08120f] px-4 py-2 gap-3 text-xs select-none shadow-md z-30">
      {/* 1. ROLE SWITCHER & CONNECTION SEGMENT */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Role Toggle Pill */}
        <div className="flex rounded-xl border border-white/10 bg-black/30 p-0.5 shadow-inner">
          <button
            onClick={() => onRoleChange('master')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${
              activeTab.role === 'master'
                ? 'bg-cyan-300 text-[#07100e] shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3 h-3" />
            MASTER
          </button>
          <button
            onClick={() => onRoleChange('slave')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${
              activeTab.role === 'slave'
                ? 'bg-amber-300 text-[#07100e] shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3 h-3" />
            SLAVE
          </button>
        </div>

        {/* Separator */}
        <div className="h-5 w-[1px] bg-white/10 mx-0.5 hidden sm:block" />

        {/* Connection Type Quick Select */}
        <div className="flex items-center bg-[#050c0a] border border-white/10 rounded-xl p-0.5">
          <button
            disabled={isConnected}
            onClick={() => setConnType('serial')}
            className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition ${
              connType === 'serial' ? 'bg-white/10 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Modbus RTU qua cổng Serial COM vật lý"
          >
            Serial
          </button>
          <button
            disabled={isConnected}
            onClick={() => setConnType('tcp')}
            className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition ${
              connType === 'tcp' ? 'bg-white/10 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Modbus TCP qua mạng Ethernet/WiFi"
          >
            TCP
          </button>
          <button
            disabled={isConnected}
            onClick={() => setConnType('simulator')}
            className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition ${
              connType === 'simulator' ? 'bg-white/10 text-purple-300' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Mô phỏng đồng hồ ảo 3 pha không cần phần cứng"
          >
            Sim
          </button>
        </div>

        {/* Connection Parameters: Serial vs TCP */}
        {connType === 'serial' && (
          <div className="flex items-center gap-1.5 font-mono">
            {/* Port Select */}
            <div className="flex items-center bg-[#050c0a] border border-white/10 rounded-xl px-2 py-0.5">
              <select
                disabled={activeTab.role === 'slave' ? isListening : isConnected}
                value={port}
                onMouseDown={() => onRefreshPorts()}
                onFocus={() => onRefreshPorts()}
                onChange={(e) => setPort(e.target.value)}
                className="bg-transparent text-white text-[11px] outline-none max-w-[165px] truncate cursor-pointer disabled:opacity-60 font-semibold"
                title="Chọn cổng COM giao tiếp"
              >
                {sortSerialPorts(availablePorts).length > 0 ? (
                  sortSerialPorts(availablePorts).map((p) => (
                    <option key={p.port_name} value={p.port_name} className="bg-slate-900 text-white font-medium">
                      {formatPortLabel(p)}
                    </option>
                  ))
                ) : (
                  <option value={port} className="bg-slate-900 text-white">{port}</option>
                )}
              </select>
              <button
                disabled={activeTab.role === 'slave' ? isListening : isConnected}
                onClick={() => {
                  setIsRefreshing(true);
                  onRefreshPorts();
                  setTimeout(() => setIsRefreshing(false), 600);
                }}
                className="text-cyan-400 hover:text-cyan-200 hover:bg-white/10 ml-1 p-1 rounded-md transition"
                title="Làm mới danh sách cổng COM (Nhận USB vừa cắm)"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
            </div>

            {/* Baudrate Preset */}
            <select
              disabled={activeTab.role === 'slave' ? isListening : isConnected}
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              className="bg-[#050c0a] border border-white/10 text-white text-[11px] rounded-xl px-2 py-1 outline-none cursor-pointer disabled:opacity-60"
            >
              {[
                300, 600, 1200, 2400, 4800, 9600, 14400, 19200,
                28800, 38400, 56000, 57600, 115200, 128000,
                230400, 256000, 460800, 921600,
              ].map((b) => (
                <option key={b} value={b} className="bg-slate-900">
                  {b}
                </option>
              ))}
            </select>

            {/* Framing Preset (8-N-1, 8-E-1, 8-O-1, 8-N-2) */}
            <select
              disabled={activeTab.role === 'slave' ? isListening : isConnected}
              value={`${parity}-${stopBits}`}
              onChange={(e) => {
                const parts = e.target.value.split('-');
                setParity(parts[0]);
                setStopBits(Number(parts[1]) || 1);
              }}
              className="bg-[#050c0a] border border-white/10 text-white text-[11px] rounded-xl px-2 py-1 outline-none cursor-pointer disabled:opacity-60 font-semibold text-cyan-300"
              title="Cấu hình Khung truyền (Data Bits - Parity - Stop Bits)"
            >
              <option value="none-1" className="bg-slate-900 text-white">8-N-1</option>
              <option value="even-1" className="bg-slate-900 text-white">8-E-1</option>
              <option value="odd-1" className="bg-slate-900 text-white">8-O-1</option>
              <option value="none-2" className="bg-slate-900 text-white">8-N-2</option>
            </select>
          </div>
        )}

        {connType === 'tcp' && (
          <div className="flex items-center gap-1.5 font-mono">
            <input
              disabled={activeTab.role === 'slave' ? isListening : isConnected}
              type="text"
              value={tcpHost}
              onChange={(e) => setTcpHost(e.target.value)}
              placeholder="127.0.0.1"
              className="w-24 bg-[#050c0a] border border-white/10 text-white text-[11px] rounded-xl px-2 py-1 outline-none"
            />
            <span className="text-slate-500">:</span>
            <input
              disabled={activeTab.role === 'slave' ? isListening : isConnected}
              type="number"
              value={tcpPort}
              onChange={(e) => setTcpPort(Number(e.target.value))}
              className="w-14 bg-[#050c0a] border border-white/10 text-white text-[11px] rounded-xl px-2 py-1 outline-none"
            />
          </div>
        )}

        {/* 1-Click Connect Button (Master) or Start Server Button (Slave) */}
        {activeTab.role === 'slave' ? (
          <button
            onClick={handleToggleSlave}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[10px] transition shadow-md ${
              isListening
                ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                : 'bg-amber-300 text-[#07100e] hover:bg-amber-200'
            }`}
            title={isListening ? 'Dừng Modbus Slave Server' : 'Khởi động Modbus Slave Server lắng nghe trên cổng đã chọn'}
          >
            {isListening ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Dừng Server</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Chạy Server</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleQuickConnect}
            disabled={isConnecting}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[10px] transition shadow-md ${
              isConnected
                ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                : 'bg-emerald-300 text-[#07100e] hover:bg-emerald-200'
            }`}
          >
            {isConnected ? (
              <>
                <Unplug className="w-3.5 h-3.5" />
                <span>Ngắt</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{isConnecting ? 'Đang nối…' : 'Kết nối'}</span>
              </>
            )}
          </button>
        )}

        {/* Settings Cog */}
        <button
          onClick={activeTab.role === 'slave' ? onOpenSlaveSetup : onOpenAdvancedConnection}
          className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition"
          title={activeTab.role === 'slave' ? 'Cấu hình Slave Server & Simulation' : 'Mở cấu hình kết nối nâng cao (Timeout, RTU over TCP...)'}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. POLLING & DEFINITION SEGMENT (MASTER) / SLAVE CONTROL */}
      <div className="flex flex-wrap items-center gap-2">
        {activeTab.role === 'master' ? (
          <>
            {/* Quick Definition Fields */}
            <div className="flex items-center bg-[#050c0a] border border-white/10 rounded-xl px-2 py-1 gap-1.5 font-mono text-[11px]">
              {/* Slave ID */}
              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[9px] uppercase">ID:</span>
                <input
                  type="number"
                  min={1}
                  max={247}
                  value={slaveId}
                  onChange={(e) => setSlaveId(Number(e.target.value))}
                  onBlur={() => commitDefinition()}
                  onKeyDown={(e) => e.key === 'Enter' && commitDefinition()}
                  className="w-10 bg-transparent text-cyan-300 text-center font-bold outline-none"
                  title="Slave ID / Unit ID (1 - 247)"
                />
              </div>

              <span className="text-slate-700">|</span>

              {/* Function Code */}
              <select
                value={fc}
                onChange={(e) => {
                  const newFc = Number(e.target.value);
                  setFc(newFc);
                  commitDefinition({ function_code: newFc });
                }}
                className="bg-transparent text-emerald-300 outline-none cursor-pointer"
                title="Function Code (Mã hàm đọc)"
              >
                <option value={3} className="bg-slate-900 text-white">FC03 Holding</option>
                <option value={4} className="bg-slate-900 text-white">FC04 Input</option>
                <option value={1} className="bg-slate-900 text-white">FC01 Coils</option>
                <option value={2} className="bg-slate-900 text-white">FC02 Discrete</option>
              </select>

              <span className="text-slate-700">|</span>

              {/* Start Address */}
              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[9px] uppercase">Addr:</span>
                <input
                  type="text"
                  value={startAddrInput}
                  onChange={(e) => setStartAddrInput(e.target.value)}
                  onBlur={() => commitDefinition()}
                  onKeyDown={(e) => e.key === 'Enter' && commitDefinition()}
                  placeholder="0 hoặc 0x0113"
                  className="w-16 bg-transparent text-white font-bold outline-none uppercase"
                  title="Địa chỉ thanh ghi bắt đầu (Hỗ trợ Dec hoặc Hex 0x...)"
                />
              </div>

              <span className="text-slate-700">|</span>

              {/* Quantity */}
              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[9px] uppercase">Qty:</span>
                <input
                  type="number"
                  min={1}
                  max={250}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  onBlur={() => commitDefinition()}
                  onKeyDown={(e) => e.key === 'Enter' && commitDefinition()}
                  className="w-10 bg-transparent text-amber-300 text-center font-bold outline-none"
                  title="Số lượng điểm đọc (tự động tách khối nếu > 120 hoặc có thanh ghi cấm đọc)"
                />
              </div>

              <button
                onClick={onOpenAdvancedDefinition}
                className="text-slate-500 hover:text-slate-300 p-0.5 ml-0.5"
                title="Cài đặt định nghĩa nâng cao (Tốc độ quét ms...)"
              >
                <Sliders className="w-3 h-3" />
              </button>
            </div>

            {/* Play/Pause Polling */}
            <button
              disabled={!isConnected}
              onClick={onTogglePoll}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[10px] transition shadow-md disabled:opacity-30 disabled:cursor-not-allowed ${
                isPolling
                  ? 'bg-amber-300/15 border border-amber-300/40 text-amber-200 hover:bg-amber-300/25 animate-pulse'
                  : 'bg-emerald-300/20 border border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/30'
              }`}
            >
              {isPolling ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isPolling ? 'Dừng Polling' : 'Bật Polling'}</span>
            </button>

            {/* Read Once Button */}
            <button
              disabled={!isConnected || isPolling}
              onClick={onReadOnce}
              className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition disabled:opacity-30"
              title="Đọc một lần duy nhất (Single Read)"
            >
              <Radio className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          /* SLAVE QUICK CONTROL */
          <div className="flex items-center gap-2">
            <select
              value={activeTab.slaveTable}
              onChange={(e) => onTableChange(e.target.value as SlaveTable)}
              className="bg-[#050c0a] border border-amber-300/30 text-amber-200 text-[11px] rounded-xl px-2.5 py-1 outline-none font-bold cursor-pointer"
            >
              <option value="holding">4x Holding Registers</option>
              <option value="input">3x Input Registers</option>
              <option value="coils">0x Coils</option>
              <option value="discrete">1x Discrete Inputs</option>
            </select>

            {/* Slave ID quick indicator */}
            <div className="flex items-center bg-[#050c0a] border border-white/10 rounded-xl px-2.5 py-1 gap-1.5 font-mono text-[11px]">
              <span className="text-slate-500 text-[9px] uppercase">ID:</span>
              <span className="text-amber-300 font-bold">
                {activeTab.slaveConfig?.slave_id_end && activeTab.slaveConfig.slave_id_end > (activeTab.slaveConfig.slave_id || 1)
                  ? `${activeTab.slaveConfig.slave_id || 1}..${activeTab.slaveConfig.slave_id_end} (Multi-Slave)`
                  : `${activeTab.slaveConfig?.slave_id || 1}`}
              </span>
            </div>

            <button
              onClick={onOpenSlaveSetup}
              className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition"
              title="Cấu hình Dải Slave ID & Mô phỏng Simulation"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 3. METRICS / TELEMETRY STATUS */}
        <div className="hidden xl:flex items-center bg-[#050c0a] border border-white/10 rounded-xl px-3 py-1 gap-3 font-mono text-[10px]">
          <div className="flex items-center gap-1">
            <span className="text-slate-500">TX:</span>
            <span className="font-bold text-cyan-300">{txCount}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">ERR:</span>
            <span className={`font-bold ${errCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`}>
              {errCount}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">RTT:</span>
            <span className="font-bold text-emerald-300">{latencyMs || 0} ms</span>
          </div>

          <button
            onClick={onClearCounters}
            className="text-slate-600 hover:text-slate-300 ml-1"
            title="Reset bộ đếm TX/ERR"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>

        {/* 4. QUICK FORMAT & VIEW CONTROLS */}
        <div className="flex items-center gap-1.5 pl-1 border-l border-white/10">
          {/* Format Selector */}
          {format && onFormatChange && (
            <div className="flex items-center bg-[#050c0a] border border-white/10 rounded-xl px-2 py-1 text-[11px]">
              <Binary className="w-3 h-3 text-cyan-400 mr-1.5 shrink-0" />
              <select
                value={format}
                onChange={(e) => onFormatChange(e.target.value as DataFormat)}
                className="bg-transparent text-cyan-200 outline-none font-semibold cursor-pointer text-[10px]"
                title="Định dạng hiển thị giá trị thanh ghi"
              >
                <option value="uint16">UInt16 (Unsigned 16b)</option>
                <option value="int16">Int16 (Signed 16b)</option>
                <option value="hex">Hex (16b Hex)</option>
                <option value="binary">Binary (Nhị phân)</option>
                <option value="float32_ab_cd">Float32 (Big-Endian AB CD)</option>
                <option value="float32_cd_ab">Float32 (Little-Endian CD AB)</option>
                <option value="float32_ba_dc">Float32 (Byte-Swapped BA DC)</option>
                <option value="float32_dc_ba">Float32 (Inverted DC BA)</option>
                <option value="int32_ab_cd">Int32 (AB CD)</option>
                <option value="int32_cd_ab">Int32 (CD AB)</option>
                <option value="uint32_ab_cd">UInt32 (AB CD)</option>
                <option value="uint32_cd_ab">UInt32 (CD AB)</option>
                <option value="water_meter_48bcd">Đồng hồ nước (48-bit BCD)</option>
              </select>
            </div>
          )}

          {/* New Instance Parallel Window */}
          <button
            onClick={() => openNewInstance()}
            className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition"
            title="Mở thêm một cửa sổ phần mềm độc lập mới để test song song (New Instance)"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* Split View Toggle */}
          {onToggleSplitView && (
            <button
              onClick={onToggleSplitView}
              className={`p-1.5 rounded-xl border transition ${
                isSplitView
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                  : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title="Chia đôi màn hình quan sát song song 2 bảng"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Inspector Panel Toggle */}
          {onToggleInspector && (
            <button
              onClick={onToggleInspector}
              className={`p-1.5 rounded-xl border transition ${
                showInspector
                  ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-300'
                  : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title="Bật/Tắt Quick Inspector thanh bên"
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Traffic Stream Toggle */}
          {onToggleTraffic && (
            <button
              onClick={onToggleTraffic}
              className={`p-1.5 rounded-xl border transition ${
                showTraffic
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title="Bật/Tắt Communication Traffic Hex Sniffer"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
