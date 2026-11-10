// Shared constants and formatters for Protocol Analyzer subcomponents

export const FRAME_ROW_HEIGHT = 36;

export const stateTone: Record<string, string> = {
  healthy: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  degraded: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  critical: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  suspected_offline: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  offline: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  unknown: 'text-slate-400 border-slate-700 bg-slate-800/50',
};

export const stateLabel: Record<string, string> = {
  healthy: 'Ổn định',
  degraded: 'Suy giảm',
  critical: 'Nghiêm trọng',
  suspected_offline: 'Nghi mất kết nối',
  offline: 'Mất kết nối',
  not_polled: 'Không được poll',
  unknown: 'Chưa đủ dữ liệu',
};

export const formatLatency = (us?: number): string => {
  if (!us) return '—';
  if (us < 1000) return `${us} µs`;
  return `${(us / 1000).toFixed(us < 10000 ? 2 : 1)} ms`;
};
