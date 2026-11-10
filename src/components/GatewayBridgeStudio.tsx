import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Activity,
  ArrowRightLeft,
  Trash2,
  X,
  Server,
} from 'lucide-react';
import {
  gatewayStart,
  gatewayStop,
  gatewayGetStats,
  subscribeGatewayTraffic,
  listSerialPorts,
} from '../services/backend';
import { SerialPortDetail } from '../types/modbus';

interface GatewayTrafficEvent {
  timestamp: string;
  client_addr: string;
  unit_id: number;
  function: string;
  tcp_tx_hex: string;
  rtu_tx_hex: string;
  rtu_rx_hex: string;
  latency_ms: number;
  status: string;
  description: string;
}

interface GatewayBridgeStudioProps {
  onClose: () => void;
}

export const GatewayBridgeStudio: React.FC<GatewayBridgeStudioProps> = ({ onClose }) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [tcpPort, setTcpPort] = useState<number>(1502);
  const [serialPort, setSerialPort] = useState<string>('COM1');
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [framing, setFraming] = useState<string>('none-1');
  const [timeoutMs, setTimeoutMs] = useState<number>(1000);
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);
  const [traffic, setTraffic] = useState<GatewayTrafficEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [stats, setStats] = useState({
    active_clients: 0,
    packets_bridged: 0,
    packets_failed: 0,
    bytes_tx: 0,
    bytes_rx: 0,
    last_latency_ms: 0,
  });

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load ports
  const refreshPorts = async () => {
    try {
      const ports = await listSerialPorts();
      setAvailablePorts(ports);
      if (ports.length > 0 && !ports.some((p: SerialPortDetail) => p.port_name === serialPort)) {
        setSerialPort(ports[0].port_name);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshPorts();
    // Poll stats
    const timer = setInterval(async () => {
      const s = await gatewayGetStats();
      if (s) {
        setIsRunning(s.is_running || false);
        setStats({
          active_clients: s.active_clients || 0,
          packets_bridged: s.packets_bridged || 0,
          packets_failed: s.packets_failed || 0,
          bytes_tx: s.bytes_tx || 0,
          bytes_rx: s.bytes_rx || 0,
          last_latency_ms: s.last_latency_ms || 0,
        });
      }
    }, 1000);

    // Subscribe traffic stream
    const unsubscribe = subscribeGatewayTraffic((event: GatewayTrafficEvent) => {
      setTraffic((prev) => [...prev.slice(-499), event]);
    });

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [traffic, autoScroll]);

  const handleToggleBridge = async () => {
    if (isRunning) {
      await gatewayStop();
      setIsRunning(false);
    } else {
      const [parity, stopBitsStr] = framing.split('-');
      try {
        await gatewayStart({
          tcp_port: Number(tcpPort) || 1502,
          serial_port: serialPort,
          baud_rate: Number(baudRate) || 9600,
          data_bits: 8,
          parity: parity || 'none',
          stop_bits: Number(stopBitsStr) || 1,
          timeout_ms: Number(timeoutMs) || 1000,
        });
        setIsRunning(true);
      } catch (err: any) {
        alert(`Khởi động Cầu nối Gateway thất bại: ${err}`);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <ArrowRightLeft className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white text-sm">Modbus Transparent Gateway Bridge</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-700/50">
                TCP ↔ RTU
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Cầu nối chuyển đổi trong suốt: Nhận Modbus TCP từ SCADA/HMI và chuyển tiếp ra RS485 Serial tới thiết bị phần cứng thật.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Đóng Gateway"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. CONFIGURATION BAR & CONTROLS */}
      <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* TCP Port Input */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-slate-400 font-medium">TCP Port:</span>
            <input
              type="number"
              disabled={isRunning}
              value={tcpPort}
              onChange={(e) => setTcpPort(Number(e.target.value))}
              className="w-16 bg-transparent text-white font-mono font-bold text-xs outline-none"
              placeholder="1502"
            />
          </div>

          {/* Serial Port Select */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Cổng COM Đích:</span>
            <select
              disabled={isRunning}
              value={serialPort}
              onChange={(e) => setSerialPort(e.target.value)}
              className="bg-transparent text-white font-mono font-bold text-xs outline-none cursor-pointer"
            >
              {availablePorts.map((p) => (
                <option key={p.port_name} value={p.port_name} className="bg-slate-900 text-white">
                  {p.port_name} {p.description ? `(${p.description.slice(0, 16)})` : ''}
                </option>
              ))}
            </select>
            <button
              disabled={isRunning}
              onClick={refreshPorts}
              className="text-slate-400 hover:text-cyan-300 transition"
              title="Làm mới cổng COM"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* Baudrate */}
          <select
            disabled={isRunning}
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 text-white font-mono text-xs rounded-xl px-3 py-1.5 outline-none cursor-pointer"
          >
            <option value={9600} className="bg-slate-900">9600 bps</option>
            <option value={19200} className="bg-slate-900">19200 bps</option>
            <option value={38400} className="bg-slate-900">38400 bps</option>
            <option value={57600} className="bg-slate-900">57600 bps</option>
            <option value={115200} className="bg-slate-900">115200 bps</option>
          </select>

          {/* Framing */}
          <select
            disabled={isRunning}
            value={framing}
            onChange={(e) => setFraming(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-cyan-300 font-mono text-xs rounded-xl px-3 py-1.5 outline-none cursor-pointer font-bold"
          >
            <option value="none-1" className="bg-slate-900 text-white">8-N-1</option>
            <option value="even-1" className="bg-slate-900 text-white">8-E-1</option>
            <option value="odd-1" className="bg-slate-900 text-white">8-O-1</option>
            <option value="none-2" className="bg-slate-900 text-white">8-N-2</option>
          </select>

          {/* Timeout */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium">Timeout:</span>
            <input
              type="number"
              disabled={isRunning}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-14 bg-transparent text-white font-mono font-bold text-xs outline-none"
              placeholder="1000"
            />
            <span className="text-[10px] text-slate-500">ms</span>
          </div>
        </div>

        {/* Start / Stop Toggle Button */}
        <button
          onClick={handleToggleBridge}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs transition shadow-lg ${
            isRunning
              ? 'bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30'
              : 'bg-emerald-300 text-slate-950 hover:bg-emerald-200'
          }`}
        >
          {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{isRunning ? 'Dừng Cầu Nối' : 'Kích Hoạt Gateway'}</span>
        </button>
      </div>

      {/* 3. METRICS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-5 bg-slate-950 border-b border-slate-800">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Trạng Thái Bridge</span>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className={`font-mono font-bold text-sm ${isRunning ? 'text-emerald-300' : 'text-slate-500'}`}>
              {isRunning ? 'ONLINE' : 'STOPPED'}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">SCADA Clients</span>
          <span className="font-mono font-bold text-lg text-cyan-300 mt-1">{stats.active_clients} kết nối</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Gói Đã Chuyển Đổi</span>
          <span className="font-mono font-bold text-lg text-emerald-400 mt-1">{stats.packets_bridged} pkts</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Lỗi / Timeout</span>
          <span className={`font-mono font-bold text-lg mt-1 ${stats.packets_failed > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
            {stats.packets_failed} pkts
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Độ Trễ Phản Hồi</span>
          <span className="font-mono font-bold text-lg text-amber-300 mt-1">{stats.last_latency_ms} ms</span>
        </div>
      </div>

      {/* 4. REALTIME TRAFFIC BRIDGE LOG */}
      <div className="flex-1 flex flex-col min-h-0 p-5 overflow-hidden">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              Nhật Ký Chuyển Tiếp Khung Giao Thức (Packet Bridge Inspector)
            </span>
            <span className="text-slate-500 font-mono text-[11px]">({traffic.length} frames)</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-cyan-500"
              />
              <span>Tự cuộn</span>
            </label>

            <button
              onClick={() => setTraffic([])}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition text-xs"
              title="Xóa lịch sử log"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa Log</span>
            </button>
          </div>
        </div>

        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto bg-slate-900/70 border border-slate-800/90 rounded-2xl p-3 font-mono text-[11px] space-y-1.5"
        >
          {traffic.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
              <ArrowRightLeft className="w-8 h-8 mb-2 opacity-30" />
              <p>Đang chờ các yêu cầu Modbus TCP từ SCADA / HMI...</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Hướng dẫn: Kết nối phần mềm SCADA hoặc máy khách tới địa chỉ 127.0.0.1:{tcpPort}
              </p>
            </div>
          ) : (
            traffic.map((t, idx) => (
              <div
                key={idx}
                className="p-2 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-cyan-500/40 transition flex flex-col gap-1"
              >
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{t.timestamp}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">{t.client_addr}</span>
                    <span className="text-cyan-400 font-bold">Unit {t.unit_id}</span>
                    <span className="text-amber-300 font-bold">{t.function}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{t.latency_ms} ms</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        t.status === 'OK'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/40'
                          : 'bg-rose-950 text-rose-300 border border-rose-700/40'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1 pt-1 border-t border-slate-900 text-[10px]">
                  <div className="truncate">
                    <span className="text-slate-500 mr-1">TCP RX:</span>
                    <span className="text-slate-300">{t.tcp_tx_hex}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-cyan-500 mr-1">RTU TX:</span>
                    <span className="text-cyan-300">{t.rtu_tx_hex}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-emerald-500 mr-1">RTU RX:</span>
                    <span className={t.rtu_rx_hex ? 'text-emerald-300' : 'text-slate-600'}>
                      {t.rtu_rx_hex || '(Không có phản hồi)'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
