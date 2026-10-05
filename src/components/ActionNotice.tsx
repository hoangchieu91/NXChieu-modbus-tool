import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export interface ActionNoticeState {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

export const ActionNotice = ({ notice, onClose }: { notice: ActionNoticeState | null; onClose: () => void }) => {
  if (!notice) return null;
  const Icon = notice.tone === 'success' ? CheckCircle2 : notice.tone === 'error' ? TriangleAlert : Info;
  const tone = notice.tone === 'success'
    ? 'border-emerald-300/25 bg-[#0b211a] text-emerald-100'
    : notice.tone === 'error'
      ? 'border-rose-300/25 bg-[#251012] text-rose-100'
      : 'border-cyan-300/25 bg-[#0b1c22] text-cyan-100';

  return <div role="status" className={`fixed bottom-11 right-5 z-[120] flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,.55)] ${tone}`}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <span className="text-[11px] leading-5">{notice.message}</span>
    <button onClick={onClose} className="ml-2 text-current opacity-50 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
  </div>;
};
