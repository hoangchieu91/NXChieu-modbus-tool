import React, { useState } from 'react';
import {
  Play,
  CheckCircle,
  RefreshCw,
  Check,
} from 'lucide-react';
import { SerialPortDetail, BaudScanItem } from '../../types/modbus';
import { autoDetectBaudrate } from '../../services/backend';

interface BaudrateScannerTabProps {
  availablePorts: SerialPortDetail[];
  onApplyConnection?: (port: string, baud: number, parity: string) => void;
  onClose: () => void;
}

export const BaudrateScannerTab: React.FC<BaudrateScannerTabProps> = ({
  availablePorts,
  onApplyConnection,
  onClose,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>(() => availablePorts[0]?.port_name || 'COM1');
  const [baudTestSlaveId, setBaudTestSlaveId] = useState<number>(1);
  const [selectedBauds, setSelectedBauds] = useState<number[]>([9600, 19200, 115200, 38400, 4800, 57600]);
  const [selectedParities, setSelectedParities] = useState<string[]>(['none', 'even', 'odd']);
  const [baudScanning, setBaudScanning] = useState<boolean>(false);
  const [baudResults, setBaudResults] = useState<BaudScanItem[]>([]);
  const [matchedBaud, setMatchedBaud] = useState<BaudScanItem | null>(null);

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

  return (
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
  );
};
