import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { TabSession, SlaveScanItem } from '../../types/modbus';
import { scanSlaveIDs } from '../../services/backend';

interface SlaveIdScannerTabProps {
  activeSession: TabSession | null;
  onApplySlaveId?: (slaveId: number) => void;
  onClose: () => void;
  isOpen: boolean;
}

export const SlaveIdScannerTab: React.FC<SlaveIdScannerTabProps> = ({
  activeSession,
  onApplySlaveId,
  onClose,
  isOpen,
}) => {
  const [slaveStart, setSlaveStart] = useState<number>(1);
  const [slaveEnd, setSlaveEnd] = useState<number>(32);
  const [slaveTimeout, setSlaveTimeout] = useState<number>(300);
  const [slaveScanning, setSlaveScanning] = useState<boolean>(false);
  const [slaveResults, setSlaveResults] = useState<SlaveScanItem[]>([]);
  const [slaveProgress, setSlaveProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const slaveScanRef = useRef<{ cancelled: boolean } | null>(null);

  // Closing the modal cancels a running Slave ID scan.
  useEffect(() => {
    if (!isOpen && slaveScanRef.current) {
      slaveScanRef.current.cancelled = true;
      slaveScanRef.current = null;
      setSlaveScanning(false);
    }
  }, [isOpen]);

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

  return (
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
              step={50}
              min={50}
              max={3000}
              value={slaveTimeout}
              onChange={(e) => setSlaveTimeout(parseInt(e.target.value) || 300)}
              className="w-16 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-center focus:border-cyan-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">ms</span>
            <div className="flex items-center gap-1">
              {[150, 300, 500].map((t) => (
                <button
                  key={t}
                  onClick={() => setSlaveTimeout(t)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border transition ${
                    slaveTimeout === t
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                      : 'text-slate-500 hover:text-slate-300 border-slate-800'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
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
  );
};
