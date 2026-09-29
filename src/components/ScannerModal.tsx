import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Square,
  Search,
  CheckCircle,
  AlertCircle,
  Cpu,
  Layers,
  Radio,
  FileSpreadsheet,
  Check,
  Zap,
  Activity,
  Droplets,
  Sliders,
  RefreshCw,
} from 'lucide-react';
import {
  TabSession,
  SerialPortDetail,
  SlaveScanItem,
  BaudScanItem,
  RegisterScanItem,
  MultiColumnDecoded,
} from '../types/modbus';
import {
  listSerialPorts,
  scanSlaveIDs,
  autoDetectBaudrate,
  scanRegisters,
} from '../services/backend';
import { decodeAllColumns, parseModbusAddress, formatModbusAddress } from '../utils/formatters';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: TabSession | null;
  onApplySlaveId?: (slaveId: number) => void;
  onApplyConnection?: (port: string, baud: number, parity: string) => void;
  onApplyRange?: (fc: number, startAddr: number, qty: number) => void;
}

type TabType = 'slave' | 'baudrate' | 'registers';

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  activeSession,
  onApplySlaveId,
  onApplyConnection,
  onApplyRange,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('slave');

  // --- Tab 1: Slave ID Scanner State ---
  const [slaveStart, setSlaveStart] = useState<number>(1);
  const [slaveEnd, setSlaveEnd] = useState<number>(32);
  const [slaveTimeout, setSlaveTimeout] = useState<number>(100);
  const [slaveScanning, setSlaveScanning] = useState<boolean>(false);
  const [slaveResults, setSlaveResults] = useState<SlaveScanItem[]>([]);
  const [slaveProgress, setSlaveProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  // Each scan gets its own token, so a stopped scan can never resume alongside a new one.
  const slaveScanRef = useRef<{ cancelled: boolean } | null>(null);

  // --- Tab 2: Baudrate Auto-detect State ---
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('COM1');
  const [baudTestSlaveId, setBaudTestSlaveId] = useState<number>(1);
  const [selectedBauds, setSelectedBauds] = useState<number[]>([9600, 19200, 115200, 38400, 4800, 57600]);
  const [selectedParities, setSelectedParities] = useState<string[]>(['none', 'even', 'odd']);
  const [baudScanning, setBaudScanning] = useState<boolean>(false);
  const [baudResults, setBaudResults] = useState<BaudScanItem[]>([]);
  const [matchedBaud, setMatchedBaud] = useState<BaudScanItem | null>(null);

  // --- Tab 3: Register Explorer & Multi-Column State ---
  const [regFc, setRegFc] = useState<number>(3);
  const [regStart, setRegStart] = useState<number>(0);
  const [regEnd, setRegEnd] = useState<number>(60);
  const [regAddrMode, setRegAddrMode] = useState<'dec' | 'hex'>('dec');
  const [regStartInput, setRegStartInput] = useState<string>('0');
  const [regEndInput, setRegEndInput] = useState<string>('60');
  const [regScanning, setRegScanning] = useState<boolean>(false);
  const [regResults, setRegResults] = useState<RegisterScanItem[]>([]);
  const [multiRows, setMultiRows] = useState<MultiColumnDecoded[]>([]);
  // Range of the last completed scan; "apply" uses it, not the (possibly edited) form fields.
  const [scannedRange, setScannedRange] = useState<{ fc: number; start: number; end: number } | null>(null);

  const handleToggleRegAddrMode = (mode: 'dec' | 'hex') => {
    if (mode === regAddrMode) return;
    setRegAddrMode(mode);
    if (mode === 'hex') {
      setRegStartInput(formatModbusAddress(regStart, 'hex'));
      setRegEndInput(formatModbusAddress(regEnd, 'hex'));
    } else {
      setRegStartInput(formatModbusAddress(regStart, 'dec'));
      setRegEndInput(formatModbusAddress(regEnd, 'dec'));
    }
  };

  const handleRegStartChange = (valStr: string) => {
    setRegStartInput(valStr);
    const parsed = parseModbusAddress(valStr, regAddrMode);
    if (parsed.isValid) {
      setRegStart(parsed.value);
    }
  };

  const handleRegEndChange = (valStr: string) => {
    setRegEndInput(valStr);
    const parsed = parseModbusAddress(valStr, regAddrMode);
    if (parsed.isValid) {
      setRegEnd(parsed.value);
    }
  };

  // Columns visibility toggles for Multi-Column View
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>({
    address: true,
    hex: true,
    uint16: true,
    int16: true,
    int32_abcd: true,
    int32_cdab: true,
    uint32_abcd: false,
    float_abcd: true,
    float_cdab: true,
    float_badc: false,
    float_dcba: false,
    water_48_be: true,
    water_48_le: true,
    water_48_bcd: true,
    int64: false,
    uint64: false,
    bin: false,
    ascii: false,
  });

  // Closing the modal cancels a running Slave ID scan.
  useEffect(() => {
    if (!isOpen && slaveScanRef.current) {
      slaveScanRef.current.cancelled = true;
      slaveScanRef.current = null;
      setSlaveScanning(false);
    }
  }, [isOpen]);

  // Load serial ports on modal open
  useEffect(() => {
    if (isOpen) {
      listSerialPorts().then((ports) => {
        setAvailablePorts(ports);
        if (ports.length > 0) {
          setSelectedPort(ports[0].port_name);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // --- Handlers Tab 1: Slave ID Scanner ---
  const handleStartSlaveScan = async () => {
    if (!activeSession) return;
    if (slaveScanRef.current) slaveScanRef.current.cancelled = true;
    const scan = { cancelled: false };
    slaveScanRef.current = scan;
    setSlaveScanning(true);
    setSlaveResults([]);

    const start = Math.max(1, slaveStart);
    const end = Math.min(247, Math.max(start, slaveEnd));
    const total = end - start + 1;
    setSlaveProgress({ current: 0, total });

    const collected: SlaveScanItem[] = [];

    // Scan sequentially with progressive UI update
    for (let id = start; id <= end; id++) {
      if (scan.cancelled) break;
      setSlaveProgress({ current: id - start + 1, total });

      try {
        const batch = await scanSlaveIDs(activeSession.id, id, id, slaveTimeout);
        if (scan.cancelled) break;
        if (batch && batch.length > 0) {
          collected.push(batch[0]);
          setSlaveResults([...collected]);
        }
      } catch (err) {
        collected.push({
          slave_id: id,
          status: 'offline',
          detail: 'Error probing',
          latency_ms: 0,
        });
        setSlaveResults([...collected]);
      }
    }

    if (slaveScanRef.current === scan) {
      slaveScanRef.current = null;
      setSlaveScanning(false);
    }
  };

  const handleStopSlaveScan = () => {
    if (slaveScanRef.current) slaveScanRef.current.cancelled = true;
    slaveScanRef.current = null;
    setSlaveScanning(false);
  };

  // --- Handlers Tab 2: Baudrate Auto-detect ---
  const handleStartBaudScan = async () => {
    setBaudScanning(true);
    setBaudResults([]);
    setMatchedBaud(null);

    try {
      const results = await autoDetectBaudrate(
        selectedPort,
        baudTestSlaveId,
        selectedBauds,
        selectedParities
      );
      setBaudResults(results);
      const match = results.find((r) => r.success);
      if (match) {
        setMatchedBaud(match);
      }
    } catch (err) {
      console.error('Baudrate scan error:', err);
    } finally {
      setBaudScanning(false);
    }
  };

  // --- Handlers Tab 3: Register Explorer & Multi-Column ---
  const handleStartRegScan = async () => {
    if (!activeSession) return;
    // Re-validate the typed addresses; an invalid field must not silently scan the last valid range.
    const startParsed = parseModbusAddress(regStartInput, regAddrMode);
    const endParsed = parseModbusAddress(regEndInput, regAddrMode);
    if (!startParsed.isValid || !endParsed.isValid) {
      alert(`Địa chỉ quét không hợp lệ: ${startParsed.error || endParsed.error}`);
      return;
    }
    setRegScanning(true);
    setRegResults([]);
    setMultiRows([]);

    try {
      const start = startParsed.value;
      const end = Math.max(start, endParsed.value);
      const fc = regFc;
      const results = await scanRegisters(activeSession.id, fc, start, end);
      setRegResults(results);
      setScannedRange(results.length > 0 ? { fc, start, end: results[results.length - 1].address } : null);

      // Generate multi-column rows from registers
      const regValues = results.map((r) => (r.valid ? r.value : 0));
      const rows: MultiColumnDecoded[] = results.map((r, i) =>
        decodeAllColumns(regValues, i, r.address, fc)
      );
      setMultiRows(rows);
    } catch (err) {
      console.error('Register scan error:', err);
    } finally {
      setRegScanning(false);
    }
  };

  // Export Multi-Column data to CSV
  const handleExportCSV = () => {
    if (multiRows.length === 0) return;
    const activeCols = Object.keys(colVisibility).filter((k) => colVisibility[k]);
    const headers = ['Address', 'DisplayAddress', ...activeCols];

    const lines = [headers.join(',')];
    for (const row of multiRows) {
      const vals = [
        row.address,
        row.displayAddress,
        ...activeCols.map((k) => `"${(row as any)[k] ?? ''}"`),
      ];
      lines.push(vals.join(','));
    }

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `modbus_multi_scan_fc${regFc}_${regStart}-${regEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Quick preset toggles for columns
  const applyPresetColumns = (preset: 'standard' | 'water' | 'all') => {
    if (preset === 'standard') {
      setColVisibility({
        address: true,
        hex: true,
        uint16: true,
        int16: true,
        int32_abcd: true,
        int32_cdab: true,
        uint32_abcd: false,
        float_abcd: true,
        float_cdab: true,
        float_badc: false,
        float_dcba: false,
        water_48_be: false,
        water_48_le: false,
        water_48_bcd: false,
        int64: false,
        uint64: false,
        bin: false,
        ascii: false,
      });
    } else if (preset === 'water') {
      setColVisibility({
        address: true,
        hex: true,
        uint16: true,
        int16: false,
        int32_abcd: false,
        int32_cdab: false,
        uint32_abcd: true,
        float_abcd: true,
        float_cdab: false,
        float_badc: false,
        float_dcba: false,
        water_48_be: true,
        water_48_le: true,
        water_48_bcd: true,
        int64: false,
        uint64: false,
        bin: false,
        ascii: false,
      });
    } else {
      const all: Record<string, boolean> = {};
      Object.keys(colVisibility).forEach((k) => (all[k] = true));
      setColVisibility(all);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-6xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 rounded-lg border border-indigo-500/30 text-cyan-400">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                Bộ Quét & Thám Tử Modbus (Industrial Scanner & Explorer)
              </h2>
              <p className="text-xs text-slate-400">
                Tự động tìm kiếm Slave ID, dò thông số Baudrate/Parity và giải mã thanh ghi đa cột
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/60 px-6 gap-2 pt-2">
          <button
            onClick={() => setActiveTab('slave')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'slave'
                ? 'bg-slate-800/90 text-cyan-400 border-cyan-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Radio className="w-4 h-4" />
            1. Quét Địa Chỉ Slave (Slave ID Scanner)
          </button>
          <button
            onClick={() => setActiveTab('baudrate')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'baudrate'
                ? 'bg-slate-800/90 text-amber-400 border-amber-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Zap className="w-4 h-4" />
            2. Dò Tốc Độ Baudrate / Parity
          </button>
          <button
            onClick={() => setActiveTab('registers')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'registers'
                ? 'bg-slate-800/90 text-emerald-400 border-emerald-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Layers className="w-4 h-4" />
            3. Quét Thanh Ghi & Giải Mã Đa Cột (Multi-Column)
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ================= TAB 1: SLAVE SCANNER ================= */}
          {activeTab === 'slave' && (
            <div className="space-y-4">
              {/* Controls bar */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-400">Dải địa chỉ:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={247}
                      value={slaveStart}
                      onChange={(e) => setSlaveStart(parseInt(e.target.value) || 1)}
                      className="w-16 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-slate-500 text-xs">đến</span>
                    <input
                      type="number"
                      min={1}
                      max={247}
                      value={slaveEnd}
                      onChange={(e) => setSlaveEnd(parseInt(e.target.value) || 32)}
                      className="w-16 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  {/* Preset buttons */}
                  <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded border border-slate-800">
                    <button
                      onClick={() => {
                        setSlaveStart(1);
                        setSlaveEnd(16);
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                    >
                      1-16
                    </button>
                    <button
                      onClick={() => {
                        setSlaveStart(1);
                        setSlaveEnd(32);
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                    >
                      1-32
                    </button>
                    <button
                      onClick={() => {
                        setSlaveStart(1);
                        setSlaveEnd(127);
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                    >
                      1-127
                    </button>
                    <button
                      onClick={() => {
                        setSlaveStart(1);
                        setSlaveEnd(247);
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                    >
                      1-247
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-xs text-slate-400">Timeout:</span>
                    <input
                      type="number"
                      step={20}
                      min={50}
                      max={1000}
                      value={slaveTimeout}
                      onChange={(e) => setSlaveTimeout(parseInt(e.target.value) || 100)}
                      className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-xs text-slate-500">ms</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!slaveScanning ? (
                    <button
                      onClick={handleStartSlaveScan}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-cyan-900/30 transition"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Bắt Đầu Quét
                    </button>
                  ) : (
                    <button
                      onClick={handleStopSlaveScan}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-rose-900/30 transition animate-pulse"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Dừng Quét
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {slaveScanning && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>
                      Đang probe Slave ID: <strong className="text-cyan-400">#{slaveProgress.current + slaveStart - 1}</strong>
                    </span>
                    <span>
                      Tiến độ: {slaveProgress.current} / {slaveProgress.total} (
                      {Math.round((slaveProgress.current / Math.max(1, slaveProgress.total)) * 100)}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-cyan-500 h-full transition-all duration-150"
                      style={{
                        width: `${(slaveProgress.current / Math.max(1, slaveProgress.total)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Summary cards */}
              {slaveResults.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80">
                    <div className="text-xs text-slate-400">Tổng ID Đã Quét</div>
                    <div className="text-xl font-bold font-mono text-white mt-1">
                      {slaveResults.length}
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-950/30 rounded-lg border border-emerald-800/40">
                    <div className="text-xs text-emerald-400">Phát Hiện Online (Hợp Lệ)</div>
                    <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                      {slaveResults.filter((r) => r.status === 'online' || r.status === 'exception').length}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80">
                    <div className="text-xs text-slate-400">Không Phản Hồi (Offline)</div>
                    <div className="text-xl font-bold font-mono text-slate-500 mt-1">
                      {slaveResults.filter((r) => r.status === 'offline').length}
                    </div>
                  </div>
                </div>
              )}

              {/* Results Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-2.5 px-4 w-24">Slave ID</th>
                      <th className="py-2.5 px-4 w-36">Trạng Thái</th>
                      <th className="py-2.5 px-4 w-28 text-right">Độ Trễ (ms)</th>
                      <th className="py-2.5 px-4">Chi Tiết / Phản Hồi</th>
                      <th className="py-2.5 px-4 w-36 text-center">Hành Động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {slaveResults.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500">
                          Chưa có kết quả. Nhấn &quot;Bắt Đầu Quét&quot; để dò tìm các thiết bị Slave trên đường bus.
                        </td>
                      </tr>
                    ) : (
                      slaveResults.map((item) => {
                        const isOnline = item.status === 'online';
                        const isEx = item.status === 'exception';
                        return (
                          <tr
                            key={item.slave_id}
                            className={`hover:bg-slate-900/60 transition ${
                              isOnline
                                ? 'bg-emerald-950/20'
                                : isEx
                                ? 'bg-amber-950/20'
                                : 'opacity-60'
                            }`}
                          >
                            <td className="py-2 px-4 font-bold text-slate-200">
                              #{item.slave_id}
                            </td>
                            <td className="py-2 px-4">
                              {isOnline && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-900/40 text-emerald-400 border border-emerald-700/50">
                                  <CheckCircle className="w-3 h-3" /> ONLINE
                                </span>
                              )}
                              {isEx && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-900/40 text-amber-400 border border-amber-700/50">
                                  <AlertCircle className="w-3 h-3" /> EXCEPTION
                                </span>
                              )}
                              {!isOnline && !isEx && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-500 border border-slate-800">
                                  TIMEOUT
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-4 text-right text-slate-300">
                              {item.latency_ms > 0 ? `${item.latency_ms} ms` : '--'}
                            </td>
                            <td className="py-2 px-4 text-slate-300 font-sans truncate max-w-md">
                              {item.detail} {item.raw_rx && <span className="text-cyan-400 font-mono ml-2">[{item.raw_rx}]</span>}
                            </td>
                            <td className="py-2 px-4 text-center font-sans">
                              {(isOnline || isEx) && onApplySlaveId && (
                                <button
                                  onClick={() => {
                                    onApplySlaveId(item.slave_id);
                                    onClose();
                                  }}
                                  className="px-2.5 py-1 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 border border-cyan-700/50 rounded text-[11px] font-semibold transition"
                                >
                                  Áp Dụng ID Này
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================= TAB 2: BAUDRATE AUTO-DETECT ================= */}
          {activeTab === 'baudrate' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Port & Slave ID */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Cổng COM Cần Dò:
                    </label>
                    <select
                      value={selectedPort}
                      onChange={(e) => setSelectedPort(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:border-amber-500 focus:outline-none"
                    >
                      {availablePorts.map((p) => (
                        <option key={p.port_name} value={p.port_name}>
                          {p.port_name} {p.description ? `- ${p.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Slave ID Thử Nghiệm:
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={247}
                      value={baudTestSlaveId}
                      onChange={(e) => setBaudTestSlaveId(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Baudrates Checklist */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Tốc Độ Truyền (Baudrate):
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    {[2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                      <label key={b} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedBauds.includes(b)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedBauds([...selectedBauds, b]);
                            } else {
                              setSelectedBauds(selectedBauds.filter((x) => x !== b));
                            }
                          }}
                          className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                        />
                        <span className="font-mono">{b}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Parity Checklist & Trigger */}
                <div className="flex flex-col justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                      Kiểm Tra Chẵn Lẻ (Parity):
                    </label>
                    <div className="flex gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      {[
                        { key: 'none', label: 'None (8N1)' },
                        { key: 'even', label: 'Even (8E1)' },
                        { key: 'odd', label: 'Odd (8O1)' },
                      ].map((p) => (
                        <label key={p.key} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedParities.includes(p.key)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedParities([...selectedParities, p.key]);
                              } else {
                                setSelectedParities(selectedParities.filter((x) => x !== p.key));
                              }
                            }}
                            className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3">
                    <button
                      onClick={handleStartBaudScan}
                      disabled={baudScanning}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-amber-900/30 transition disabled:opacity-50"
                    >
                      {baudScanning ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Đang Thử Nghiệm Các Cấu Hình...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          Bắt Đầu Dò Tìm Tự Động
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Matched Banner */}
              {matchedBaud && (
                <div className="p-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-500/50 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
                      <CheckCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-emerald-300">
                        Phát Hiện Thông Số Thiết Bị Thành Công!
                      </h4>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Tốc độ: <strong className="font-mono text-white">{matchedBaud.baud_rate} bps</strong> | Parity:{' '}
                        <strong className="uppercase font-mono text-white">{matchedBaud.parity}</strong> | Độ trễ:{' '}
                        <strong className="font-mono text-emerald-400">{matchedBaud.latency_ms} ms</strong>
                      </p>
                    </div>
                  </div>
                  {onApplyConnection && (
                    <button
                      onClick={() => {
                        onApplyConnection(selectedPort, matchedBaud.baud_rate, matchedBaud.parity);
                        onClose();
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-900/30 transition"
                    >
                      Kết Nối Với Cấu Hình Này Ngay
                    </button>
                  )}
                </div>
              )}

              {/* Test Log Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-2 px-4 w-32">Baudrate</th>
                      <th className="py-2 px-4 w-32">Parity (Chẵn/Lẻ)</th>
                      <th className="py-2 px-4 w-36">Kết Quả</th>
                      <th className="py-2 px-4 w-28 text-right">Độ Trễ (ms)</th>
                      <th className="py-2 px-4">Chi Tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {baudResults.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500">
                          Chưa thử nghiệm. Nhấn &quot;Bắt Đầu Dò Tìm Tự Động&quot; để thử các tốc độ Baud và Parity.
                        </td>
                      </tr>
                    ) : (
                      baudResults.map((r, i) => (
                        <tr
                          key={i}
                          className={r.success ? 'bg-emerald-950/30 text-emerald-300 font-bold' : 'text-slate-400'}
                        >
                          <td className="py-2 px-4">{r.baud_rate} bps</td>
                          <td className="py-2 px-4 uppercase">{r.parity}</td>
                          <td className="py-2 px-4">
                            {r.success ? (
                              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                                <Check className="w-3.5 h-3.5" /> THÀNH CÔNG
                              </span>
                            ) : (
                              <span className="text-slate-500">Không khớp</span>
                            )}
                          </td>
                          <td className="py-2 px-4 text-right">
                            {r.latency_ms > 0 ? `${r.latency_ms} ms` : '--'}
                          </td>
                          <td className="py-2 px-4 font-sans text-xs">{r.detail}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================= TAB 3: REGISTER EXPLORER & MULTI-COLUMN ================= */}
          {activeTab === 'registers' && (
            <div className="space-y-4">
              {/* Scan Configuration Header */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Mã Hàm (FC):</label>
                    <select
                      value={regFc}
                      onChange={(e) => setRegFc(parseInt(e.target.value) || 3)}
                      className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value={3}>03 - Holding Registers</option>
                      <option value={4}>04 - Input Registers</option>
                    </select>
                  </div>

                  {/* Dec / Hex Mode Switch */}
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Kiểu Gõ Địa Chỉ:</label>
                    <div className="flex items-center bg-slate-900 p-0.5 rounded border border-slate-700 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => handleToggleRegAddrMode('dec')}
                        className={`px-2.5 py-1 rounded transition ${
                          regAddrMode === 'dec'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        DEC
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleRegAddrMode('hex')}
                        className={`px-2.5 py-1 rounded transition ${
                          regAddrMode === 'hex'
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        HEX (0x)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Bắt Đầu ({regAddrMode.toUpperCase()}):
                    </label>
                    <input
                      type="text"
                      value={regStartInput}
                      onChange={(e) => handleRegStartChange(e.target.value)}
                      placeholder={regAddrMode === 'hex' ? '0x0000' : '0'}
                      className="w-24 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 block text-center font-mono mt-0.5">
                      {regAddrMode === 'dec' ? formatModbusAddress(regStart, 'hex') : regStart}
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Kết Thúc ({regAddrMode.toUpperCase()}):
                    </label>
                    <input
                      type="text"
                      value={regEndInput}
                      onChange={(e) => handleRegEndChange(e.target.value)}
                      placeholder={regAddrMode === 'hex' ? '0x003C' : '60'}
                      className="w-24 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 block text-center font-mono mt-0.5">
                      {regAddrMode === 'dec' ? formatModbusAddress(regEnd, 'hex') : regEnd}
                    </span>
                  </div>

                  {/* Range shortcut chips */}
                  <div className="flex items-center gap-1 mt-4">
                    <button
                      onClick={() => {
                        const s = 0;
                        const e = 30;
                        setRegStart(s);
                        setRegEnd(e);
                        setRegStartInput(formatModbusAddress(s, regAddrMode));
                        setRegEndInput(formatModbusAddress(e, regAddrMode));
                      }}
                      className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-400 rounded border border-slate-800 font-mono"
                    >
                      {regAddrMode === 'hex' ? '0x00 - 0x1E' : '0-30'}
                    </button>
                    <button
                      onClick={() => {
                        const s = 0;
                        const e = 100;
                        setRegStart(s);
                        setRegEnd(e);
                        setRegStartInput(formatModbusAddress(s, regAddrMode));
                        setRegEndInput(formatModbusAddress(e, regAddrMode));
                      }}
                      className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-400 rounded border border-slate-800 font-mono"
                    >
                      {regAddrMode === 'hex' ? '0x00 - 0x64' : '0-100'}
                    </button>
                    <button
                      onClick={() => {
                        const s = regAddrMode === 'hex' ? 0x1000 : 1000;
                        const e = regAddrMode === 'hex' ? 0x1032 : 1050;
                        setRegStart(s);
                        setRegEnd(e);
                        setRegStartInput(formatModbusAddress(s, regAddrMode));
                        setRegEndInput(formatModbusAddress(e, regAddrMode));
                      }}
                      className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-[11px] text-cyan-400 rounded border border-slate-800 font-mono"
                    >
                      {regAddrMode === 'hex' ? '0x1000+' : '1000+'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStartRegScan}
                    disabled={regScanning}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-900/30 transition disabled:opacity-50"
                  >
                    {regScanning ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Đang Quét Dải Thanh Ghi...
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Quét Thanh Ghi
                      </>
                    )}
                  </button>

                  {regResults.length > 0 && (
                    <div className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono flex items-center gap-2">
                      <span className="text-slate-400">Đã quét: <strong className="text-white">{regResults.length}</strong></span>
                      <span className="text-slate-600">|</span>
                      <span className="text-emerald-400">Hợp lệ: <strong>{regResults.filter((r) => r.valid).length}</strong></span>
                    </div>
                  )}

                  {multiRows.length > 0 && (
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition"
                      title="Xuất kết quả giải mã ra CSV"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                      Xuất CSV
                    </button>
                  )}

                  {multiRows.length > 0 && onApplyRange && scannedRange && (
                    <button
                      onClick={() => {
                        onApplyRange(scannedRange.fc, scannedRange.start, Math.min(100, scannedRange.end - scannedRange.start + 1));
                        onClose();
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 border border-cyan-700/50 rounded-lg text-xs font-semibold transition"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Đưa Vào Bảng Giám Sát
                    </button>
                  )}
                </div>
              </div>


              {/* Dynamic Column Selector Toolbar */}
              <div className="p-3 bg-slate-950/90 rounded-xl border border-slate-800/90 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Bộ Chọn Cột Giải Mã Linh Hoạt (Dynamic Column Inspector):</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => applyPresetColumns('standard')}
                      className="px-2.5 py-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 transition"
                    >
                      Chuẩn Điện Lực (PLC/Inverter)
                    </button>
                    <button
                      onClick={() => applyPresetColumns('water')}
                      className="px-2.5 py-1 text-[11px] bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 rounded border border-indigo-800/50 transition flex items-center gap-1 font-semibold"
                    >
                      <Droplets className="w-3 h-3 text-cyan-400" />
                      Đồng Hồ Nước (3 Regs / BCD)
                    </button>
                    <button
                      onClick={() => applyPresetColumns('all')}
                      className="px-2.5 py-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 transition"
                    >
                      Bật Tất Cả Cột
                    </button>
                  </div>
                </div>

                {/* Checkbox Chips */}
                <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                  {[
                    { key: 'uint16', label: 'UInt16 (Unsigned)' },
                    { key: 'int16', label: 'Int16 (Signed)' },
                    { key: 'hex', label: 'Raw Hex (16-bit)' },
                    { key: 'int32_abcd', label: 'Int32 (ABCD)' },
                    { key: 'int32_cdab', label: 'Int32 (CDAB)' },
                    { key: 'uint32_abcd', label: 'UInt32 (ABCD)' },
                    { key: 'float_abcd', label: 'Float32 (ABCD)' },
                    { key: 'float_cdab', label: 'Float32 (CDAB)' },
                    { key: 'float_badc', label: 'Float32 (BADC)' },
                    { key: 'water_48_be', label: 'Nước 48-bit Big-Endian (3 Regs)', highlight: true },
                    { key: 'water_48_le', label: 'Nước 48-bit Little-Endian', highlight: true },
                    { key: 'water_48_bcd', label: 'Nước 48-bit BCD (12 Số Cơ Khí)', highlight: true },
                    { key: 'int64', label: 'Int64 (4 Regs)' },
                    { key: 'uint64', label: 'UInt64 (4 Regs)' },
                    { key: 'bin', label: 'Binary (16-bit)' },
                    { key: 'ascii', label: 'ASCII (2 chars)' },
                  ].map((col) => (
                    <label
                      key={col.key}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer border transition select-none ${
                        colVisibility[col.key]
                          ? col.highlight
                            ? 'bg-fuchsia-950/60 border-fuchsia-700/60 text-fuchsia-300'
                            : 'bg-slate-800 border-slate-600 text-white'
                          : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(colVisibility[col.key])}
                        onChange={(e) =>
                          setColVisibility({ ...colVisibility, [col.key]: e.target.checked })
                        }
                        className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 w-3 h-3"
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Multi-Column Data Grid */}
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950 max-h-[50vh]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-2.5 px-3 w-16 bg-slate-900 text-cyan-400">Dec Addr</th>
                      <th className="py-2.5 px-3 w-20 bg-slate-900 text-purple-400">Hex Addr</th>
                      <th className="py-2.5 px-3 w-20 bg-slate-900 text-slate-400">PLC Ref</th>
                      {colVisibility.hex && <th className="py-2.5 px-3 bg-slate-900 text-amber-400">Hex 16</th>}
                      {colVisibility.uint16 && <th className="py-2.5 px-3 bg-slate-900 text-emerald-400">UInt16</th>}
                      {colVisibility.int16 && <th className="py-2.5 px-3 bg-slate-900 text-green-400">Int16</th>}
                      {colVisibility.int32_abcd && <th className="py-2.5 px-3 bg-slate-900 text-blue-400">Int32 (ABCD)</th>}
                      {colVisibility.int32_cdab && <th className="py-2.5 px-3 bg-slate-900 text-blue-300">Int32 (CDAB)</th>}
                      {colVisibility.uint32_abcd && <th className="py-2.5 px-3 bg-slate-900 text-indigo-400">UInt32 (ABCD)</th>}
                      {colVisibility.float_abcd && <th className="py-2.5 px-3 bg-slate-900 text-cyan-400">Float32 (ABCD)</th>}
                      {colVisibility.float_cdab && <th className="py-2.5 px-3 bg-slate-900 text-cyan-300">Float32 (CDAB)</th>}
                      {colVisibility.float_badc && <th className="py-2.5 px-3 bg-slate-900 text-teal-400">Float32 (BADC)</th>}
                      {colVisibility.water_48_be && (
                        <th className="py-2.5 px-3 bg-slate-900 text-fuchsia-400">
                          Nước 48-bit (BE)
                        </th>
                      )}
                      {colVisibility.water_48_le && (
                        <th className="py-2.5 px-3 bg-slate-900 text-fuchsia-300">
                          Nước 48-bit (LE)
                        </th>
                      )}
                      {colVisibility.water_48_bcd && (
                        <th className="py-2.5 px-3 bg-slate-900 text-pink-400">
                          Nước 48-bit BCD (12 số)
                        </th>
                      )}
                      {colVisibility.int64 && <th className="py-2.5 px-3 bg-slate-900 text-violet-400">Int64 (4 Regs)</th>}
                      {colVisibility.uint64 && <th className="py-2.5 px-3 bg-slate-900 text-violet-300">UInt64</th>}
                      {colVisibility.bin && <th className="py-2.5 px-3 bg-slate-900 text-slate-400">Binary 16</th>}
                      {colVisibility.ascii && <th className="py-2.5 px-3 bg-slate-900 text-slate-300">ASCII</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {multiRows.length === 0 ? (
                      <tr>
                        <td colSpan={19} className="py-12 text-center text-slate-500 font-sans">
                          Chưa có dữ liệu. Nhấn &quot;Quét Thanh Ghi&quot; để đọc và phân tích toàn bộ các định dạng cùng lúc.
                        </td>
                      </tr>
                    ) : (
                      multiRows.map((row) => (
                        <tr key={row.address} className="hover:bg-slate-900/60 transition">
                          <td className="py-1.5 px-3 font-bold text-slate-200">{row.address}</td>
                          <td className="py-1.5 px-3 font-bold font-mono text-purple-400">
                            0x{(row.address & 0xffff).toString(16).toUpperCase().padStart(4, '0')}
                          </td>
                          <td className="py-1.5 px-3 text-slate-400">{row.displayAddress}</td>
                          {colVisibility.hex && (
                            <td className="py-1.5 px-3 text-amber-400 font-bold">{row.hex}</td>
                          )}
                          {colVisibility.uint16 && (
                            <td className="py-1.5 px-3 text-emerald-400 font-semibold">{row.uint16}</td>
                          )}
                          {colVisibility.int16 && (
                            <td className="py-1.5 px-3 text-green-300">{row.int16}</td>
                          )}
                          {colVisibility.int32_abcd && (
                            <td className="py-1.5 px-3 text-blue-400">{row.int32_abcd}</td>
                          )}
                          {colVisibility.int32_cdab && (
                            <td className="py-1.5 px-3 text-blue-300">{row.int32_cdab}</td>
                          )}
                          {colVisibility.uint32_abcd && (
                            <td className="py-1.5 px-3 text-indigo-400">{row.uint32_abcd}</td>
                          )}
                          {colVisibility.float_abcd && (
                            <td className="py-1.5 px-3 text-cyan-400 font-bold">{row.float_abcd}</td>
                          )}
                          {colVisibility.float_cdab && (
                            <td className="py-1.5 px-3 text-cyan-300">{row.float_cdab}</td>
                          )}
                          {colVisibility.float_badc && (
                            <td className="py-1.5 px-3 text-teal-400">{row.float_badc}</td>
                          )}
                          {colVisibility.water_48_be && (
                            <td className="py-1.5 px-3 text-fuchsia-400 font-bold">
                              {row.water_48_be}
                            </td>
                          )}
                          {colVisibility.water_48_le && (
                            <td className="py-1.5 px-3 text-fuchsia-300">
                              {row.water_48_le}
                            </td>
                          )}
                          {colVisibility.water_48_bcd && (
                            <td className="py-1.5 px-3 text-pink-400 font-bold">
                              {row.water_48_bcd}
                            </td>
                          )}
                          {colVisibility.int64 && (
                            <td className="py-1.5 px-3 text-violet-400">{row.int64}</td>
                          )}
                          {colVisibility.uint64 && (
                            <td className="py-1.5 px-3 text-violet-300">{row.uint64}</td>
                          )}
                          {colVisibility.bin && (
                            <td className="py-1.5 px-3 text-slate-400">{row.bin}</td>
                          )}
                          {colVisibility.ascii && (
                            <td className="py-1.5 px-3 text-slate-200 font-sans">{row.ascii}</td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-500" />
            <span>
              Session Hiện Tại:{' '}
              <strong className="text-white">
                {activeSession ? activeSession.title : 'Chưa chọn'}
              </strong>
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
