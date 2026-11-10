import React from 'react';
import { GitCompare, X } from 'lucide-react';
import { CaptureDiffResult } from '../../types/modbus';

interface CaptureDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  diffPathA: string;
  diffPathB: string;
  onSelectDiffFileA: () => void;
  onSelectDiffFileB: () => void;
  onRunDiff: () => void;
  diffLoading: boolean;
  diffResult: CaptureDiffResult | null;
  formatLatency: (us?: number) => string;
}

export const CaptureDiffModal: React.FC<CaptureDiffModalProps> = ({
  isOpen,
  onClose,
  diffPathA,
  diffPathB,
  onSelectDiffFileA,
  onSelectDiffFileB,
  onRunDiff,
  diffLoading,
  diffResult,
  formatLatency,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-cyan-900/60 bg-[#09131d] shadow-2xl overflow-hidden">
        <div className="flex h-12 items-center justify-between border-b border-slate-800 bg-[#0c1824] px-5">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Capture Diff Analyzer · So sánh 2 phiên Modbus
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-slate-800 bg-slate-950/80 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Tệp A: Baseline / Trước bảo trì
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={diffPathA}
                  placeholder="Chưa chọn tệp A (.nxcap)..."
                  className="h-8 flex-1 border border-slate-800 bg-slate-900 px-2.5 text-[11px] text-slate-300 truncate"
                />
                <button
                  onClick={onSelectDiffFileA}
                  className="h-8 border border-cyan-800 bg-cyan-950/40 px-3 text-[11px] text-cyan-300 hover:bg-cyan-900/60 whitespace-nowrap"
                >
                  Chọn tệp A
                </button>
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/80 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Tệp B: Hiện tại / Sau bảo trì
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={diffPathB}
                  placeholder="Chưa chọn tệp B (.nxcap)..."
                  className="h-8 flex-1 border border-slate-800 bg-slate-900 px-2.5 text-[11px] text-slate-300 truncate"
                />
                <button
                  onClick={onSelectDiffFileB}
                  className="h-8 border border-cyan-800 bg-cyan-950/40 px-3 text-[11px] text-cyan-300 hover:bg-cyan-900/60 whitespace-nowrap"
                >
                  Chọn tệp B
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              disabled={diffLoading || !diffPathA || !diffPathB}
              onClick={onRunDiff}
              className="flex h-9 items-center gap-2 rounded bg-cyan-600 px-4 text-xs font-bold uppercase text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              <GitCompare className="h-4 w-4" /> {diffLoading ? 'Đang so sánh...' : 'Bắt đầu Phân tích So sánh'}
            </button>
          </div>

          {diffResult && (
            <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
              <div className="rounded border border-cyan-900/50 bg-cyan-950/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-cyan-300">
                    Kết luận tổng quan (Verdict): {diffResult.verdict}
                  </span>
                  <span
                    className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      diffResult.health_score_delta >= 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    Score Δ {diffResult.health_score_delta >= 0 ? `+${diffResult.health_score_delta}` : diffResult.health_score_delta}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{diffResult.summary}</p>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded border border-slate-800 bg-slate-900/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Điểm Bus Health</div>
                  <div className="mt-1 text-base font-bold font-mono text-slate-200">
                    {diffResult.health_score_a} → {diffResult.health_score_b}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Tỷ lệ lỗi (Error Rate)</div>
                  <div className="mt-1 text-base font-bold font-mono text-slate-200">
                    {diffResult.error_rate_a.toFixed(1)}% → {diffResult.error_rate_b.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Độ trễ P95</div>
                  <div className="mt-1 text-base font-bold font-mono text-slate-200">
                    {formatLatency(diffResult.p95_latency_us_a)} → {formatLatency(diffResult.p95_latency_us_b)}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Timeout Khung tin</div>
                  <div className="mt-1 text-base font-bold font-mono text-slate-200">
                    {diffResult.timeout_count_a} → {diffResult.timeout_count_b}
                  </div>
                </div>
              </div>

              {/* Device Status Flags */}
              <div className="flex flex-wrap gap-2 text-xs">
                {diffResult.missing_devices.length > 0 && (
                  <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-rose-300">
                    ⚠ Không quan sát thấy trong Capture B ({diffResult.missing_devices.length}): Unit {diffResult.missing_devices.join(', ')}
                  </div>
                )}
                {diffResult.new_devices.length > 0 && (
                  <div className="rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-sky-300">
                    ✦ Thiết bị mới ({diffResult.new_devices.length}): Unit {diffResult.new_devices.join(', ')}
                  </div>
                )}
                {diffResult.regressed_devices.length > 0 && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                    ▼ Thiết bị suy giảm ({diffResult.regressed_devices.length}): Unit {diffResult.regressed_devices.join(', ')}
                  </div>
                )}
              </div>

              {/* Device Comparison Matrix */}
              <div className="rounded border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-950 text-slate-500 uppercase text-[9px]">
                    <tr>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2">Điểm A → B</th>
                      <th className="px-3 py-2">Thành công A → B</th>
                      <th className="px-3 py-2">P95 Trễ A → B</th>
                      <th className="px-3 py-2">Nhận xét</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/30">
                    {diffResult.device_diffs.map((d) => (
                      <tr key={d.unit_id} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-bold font-mono text-slate-200">Unit {d.unit_id}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                              d.status === 'missing'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : d.status === 'regressed'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : d.status === 'new'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : d.status === 'improved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">{d.health_score_a} → {d.health_score_b}</td>
                        <td className="px-3 py-2 font-mono">{d.success_rate_a.toFixed(1)}% → {d.success_rate_b.toFixed(1)}%</td>
                        <td className="px-3 py-2 font-mono">{formatLatency(d.p95_latency_us_a)} → {formatLatency(d.p95_latency_us_b)}</td>
                        <td className="px-3 py-2 text-slate-400 text-[10px]">{d.remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
