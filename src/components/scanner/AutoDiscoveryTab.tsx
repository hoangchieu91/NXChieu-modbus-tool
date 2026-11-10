import React, { useState, useEffect } from 'react';
import {
  Compass,
  Play,
  Square,
  CheckCircle,
  Clock,
  Radio,
  Zap,
  ArrowRight,
  ShieldAlert,
  Search,
  Check,
} from 'lucide-react';
import { SerialPortDetail, DiscoveredDevice, AutoDiscoverProgress } from '../../types/modbus';
import { autoDiscoverDevices } from '../../services/backend';

interface AutoDiscoveryTabProps {
  availablePorts: SerialPortDetail[];
  activePort: string;
  onApplyDevice: (port: string, baud: number, parity: string, slaveId: number) => void;
}

const COMMON_BAUDS = [9600, 19200, 115200, 38400, 4800, 57600];
const COMMON_PARITIES = [
  { id: 'none', label: 'None (8-N-1)' },
  { id: 'even', label: 'Even (8-E-1)' },
  { id: 'odd', label: 'Odd (8-O-1)' },
];

export const AutoDiscoveryTab: React.FC<AutoDiscoveryTabProps> = ({
  availablePorts,
  activePort,
  onApplyDevice,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>(activePort || '');
  const [selectedBauds, setSelectedBauds] = useState<number[]>([9600, 19200, 115200, 38400]);
  const [selectedParities, setSelectedParities] = useState<string[]>(['none', 'even', 'odd']);
  const [idRangeMode, setIdRangeMode] = useState<'common' | '1-16' | '1-32' | 'custom'>('common');
  const [customIds, setCustomIds] = useState<string>('1, 2, 3, 4, 5, 10, 16');
  const [stopOnFirst, setStopOnFirst] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState<number>(120);

  const [isScanning, setIsScanning] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<AutoDiscoverProgress | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [scanStatusMessage, setScanStatusMessage] = useState<string>('');

  useEffect(() => {
    if (!selectedPort && availablePorts.length > 0) {
      setSelectedPort(availablePorts[0].port_name);
    }
  }, [availablePorts, selectedPort]);

  useEffect(() => {
    // Listen for progress events from backend
    const w = window as any;
    if (w.runtime && w.runtime.EventsOn) {
      w.runtime.EventsOn('auto-discover-progress', (prog: AutoDiscoverProgress) => {
        setCurrentProgress(prog);
      });
      return () => {
        if (w.runtime.EventsOff) {
          w.runtime.EventsOff('auto-discover-progress');
        }
      };
    }
  }, []);

  const formatPortLabel = (p: SerialPortDetail) => {
    const raw = `${p.description || ''} ${p.hardware_id || ''}`;
    const m = raw.match(/Ch\s*([A-H])/i);
    if (m) {
      return `${p.port_name} (Kênh ${m[1].toUpperCase()})`;
    }
    return `${p.port_name} (${(p.description || 'Serial').slice(0, 20)})`;
  };

  const getTargetSlaveIds = (): number[] => {
    if (idRangeMode === 'common') {
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 20, 32, 100, 247];
    }
    if (idRangeMode === '1-16') {
      return Array.from({ length: 16 }, (_, i) => i + 1);
    }
    if (idRangeMode === '1-32') {
      return Array.from({ length: 32 }, (_, i) => i + 1);
    }
    // custom
    const parsed = customIds
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= 247);
    return parsed.length > 0 ? parsed : [1, 2, 3];
  };

  const toggleBaud = (b: number) => {
    if (selectedBauds.includes(b)) {
      if (selectedBauds.length > 1) setSelectedBauds(selectedBauds.filter((x) => x !== b));
    } else {
      setSelectedBauds([...selectedBauds, b]);
    }
  };

  const toggleParity = (p: string) => {
    if (selectedParities.includes(p)) {
      if (selectedParities.length > 1) setSelectedParities(selectedParities.filter((x) => x !== p));
    } else {
      setSelectedParities([...selectedParities, p]);
    }
  };

  const handleStartScan = async () => {
    if (!selectedPort) {
      setScanStatusMessage('Vui lòng chọn cổng COM trước khi dò.');
      return;
    }

    setIsScanning(true);
    setDiscoveredDevices([]);
    setScanStatusMessage('Đang thực hiện dò quét tự động toàn diện...');
    setCurrentProgress({
      phase: 'starting',
      current_baud: selectedBauds[0] || 9600,
      current_parity: selectedParities[0] || 'none',
      current_slave: 1,
      found_count: 0,
    });

    try {
      const results = await autoDiscoverDevices({
        port: selectedPort,
        bauds: selectedBauds,
        parities: selectedParities,
        slave_ids: getTargetSlaveIds(),
        timeout_ms: timeoutMs,
        stop_on_first: stopOnFirst,
      });

      setDiscoveredDevices(results);
      if (results.length > 0) {
        setScanStatusMessage(`Đã tìm thấy ${results.length} thiết bị phản hồi hợp lệ trên bus!`);
      } else {
        setScanStatusMessage('Không nhận được phản hồi nào từ thiết bị. Hãy kiểm tra lại dây A/B, nguồn cấp hoặc tăng Timeout.');
      }
    } catch (err: any) {
      setScanStatusMessage(`Lỗi quét: ${err.message || String(err)}`);
    } finally {
      setIsScanning(false);
      setCurrentProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-5 overflow-y-auto">
      {/* Intro Header */}
      <div className="flex items-start justify-between bg-gradient-to-r from-cyan-950/40 via-indigo-950/30 to-slate-900 border border-cyan-500/20 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
            <Compass className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Dò Tự Động Toàn Diện (1-Click Auto-Discovery)
              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
                PRO ENGINE
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Tự động giải mã Baudrate, Parity, Slave ID và tìm thanh ghi có phản hồi trên thiết bị không rõ nguồn gốc.
            </p>
          </div>
        </div>

        <button
          onClick={handleStartScan}
          disabled={isScanning || !selectedPort}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition ${
            isScanning
              ? 'bg-amber-500 text-slate-950 animate-pulse'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {isScanning ? (
            <>
              <Square className="w-4 h-4 fill-current" />
              <span>Đang Dò Quét...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>BẮT ĐẦU DÒ TOÀN DIỆN</span>
            </>
          )}
        </button>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Col 1: Port & Timeout */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-cyan-400" /> Cổng Serial
          </label>
          <select
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={isScanning}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
          >
            {availablePorts.map((p) => (
              <option key={p.port_name} value={p.port_name}>
                {formatPortLabel(p)}
              </option>
            ))}
          </select>

          <div className="pt-2 border-t border-slate-800">
            <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3 h-3 text-slate-400" /> Timeout mỗi probe: {timeoutMs} ms
            </label>
            <div className="flex gap-1.5">
              {[80, 120, 200, 300].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTimeoutMs(t)}
                  className={`flex-1 py-1 rounded text-[10px] font-bold border transition ${
                    timeoutMs === t
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {t}ms
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Col 2: Baudrates */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Tốc Độ Baudrate
            </label>
            <span className="text-[10px] text-slate-500">{selectedBauds.length} tốc độ</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {COMMON_BAUDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => toggleBaud(b)}
                disabled={isScanning}
                className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold border flex items-center justify-between transition ${
                  selectedBauds.includes(b)
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                <span>{b}</span>
                {selectedBauds.includes(b) && <Check className="w-3 h-3 text-cyan-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* Col 3: Parities */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" /> Chẵn Lẻ (Parity)
          </label>
          <div className="space-y-1.5 pt-1">
            {COMMON_PARITIES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleParity(p.id)}
                disabled={isScanning}
                className={`w-full py-1.5 px-2.5 rounded-lg text-[10px] font-semibold border flex items-center justify-between transition ${
                  selectedParities.includes(p.id)
                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                <span>{p.label}</span>
                {selectedParities.includes(p.id) && <Check className="w-3 h-3 text-indigo-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* Col 4: Slave ID Scope & Options */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-emerald-400" /> Dải Slave ID
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(['common', '1-16', '1-32', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setIdRangeMode(m)}
                disabled={isScanning}
                className={`py-1 rounded text-[10px] font-bold border transition ${
                  idRangeMode === m
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                {m === 'common' ? 'Phổ biến' : m === '1-16' ? '1..16' : m === '1-32' ? '1..32' : 'Tự gõ'}
              </button>
            ))}
          </div>

          {idRangeMode === 'custom' && (
            <input
              type="text"
              value={customIds}
              onChange={(e) => setCustomIds(e.target.value)}
              placeholder="VD: 1, 2, 5, 10"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200"
            />
          )}

          <div className="pt-2 border-t border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer text-[10px] text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={stopOnFirst}
                onChange={(e) => setStopOnFirst(e.target.checked)}
                disabled={isScanning}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
              <span>Dừng khi tìm thấy thiết bị đầu tiên</span>
            </label>
          </div>
        </div>
      </div>

      {/* Progress Radar Banner */}
      {isScanning && currentProgress && (
        <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            <div>
              <div className="text-xs font-bold text-white">
                Đang dò: <span className="text-cyan-400">{currentProgress.current_baud} bps</span> · Parity:{' '}
                <span className="text-indigo-400 uppercase">{currentProgress.current_parity}</span> · Slave ID:{' '}
                <span className="text-amber-400">#{currentProgress.current_slave}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Gửi Modbus probe Read Holding Reg 0/1 & Input Reg 0...
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-mono font-bold text-emerald-400">
              Đã phát hiện: {discoveredDevices.length} thiết bị
            </span>
          </div>
        </div>
      )}

      {/* Status or Results */}
      {scanStatusMessage && !isScanning && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs font-medium border ${
            discoveredDevices.length > 0
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          {scanStatusMessage}
        </div>
      )}

      {/* Discovered Devices Table */}
      <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-[220px]">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Danh Sách Thiết Bị Tìm Thấy ({discoveredDevices.length})
          </h4>
          <span className="text-[10px] text-slate-500">
            Click &quot;Áp Dụng&quot; để tự động cấu hình và mở phiên đọc ngay
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {discoveredDevices.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-600">
              <Search className="w-10 h-10 mb-2 stroke-1" />
              <p className="text-xs font-medium text-slate-400">Chưa có thiết bị nào được tìm thấy</p>
              <p className="text-[10px] text-slate-500 mt-1 max-w-sm">
                Hãy chọn đúng cổng COM cắm dây USB-RS485 rồi bấm &quot;BẮT ĐẦU DÒ TOÀN DIỆN&quot;.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {discoveredDevices.map((dev, idx) => (
                <div
                  key={idx}
                  className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/40 transition"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-sm">
                      ID: {dev.slave_id}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{dev.port}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold">
                          {dev.baud_rate} bps
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-300 font-semibold uppercase">
                          8-{dev.parity.charAt(0).toUpperCase()}-1
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                          Độ trễ: {dev.latency_ms} ms
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{dev.detail}</p>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      onApplyDevice(dev.port, dev.baud_rate, dev.parity, dev.slave_id)
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs shadow-md transition"
                  >
                    <span>Áp Dụng &amp; Đọc Ngay</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
