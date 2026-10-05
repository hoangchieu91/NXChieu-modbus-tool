import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, RefreshCw, Stethoscope, TriangleAlert, X } from 'lucide-react';

export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
  durationMs: number;
}

interface StudioDiagnosticsProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: () => Promise<DiagnosticCheck[]>;
}

export const StudioDiagnostics: React.FC<StudioDiagnosticsProps> = ({ isOpen, onClose, onRun }) => {
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);

  const run = async () => {
    setRunning(true);
    setChecks([]);
    try {
      setChecks(await onRun());
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen) void run();
  // Run once for each time the panel is opened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;
  const failed = checks.filter((check) => check.status === 'fail').length;

  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#020907]/90 p-5 backdrop-blur-md">
    <section className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-emerald-300/15 bg-[#091410] shadow-[0_30px_100px_rgba(0,0,0,.65)]">
      <header className="flex h-16 shrink-0 items-center border-b border-white/[.08] bg-[#0b1915] px-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-300/10 text-emerald-200"><Stethoscope className="h-5 w-5" /></div>
        <div className="ml-3"><h2 className="text-sm font-bold">Tự kiểm tra hệ thống</h2><p className="mt-0.5 text-[10px] text-slate-500">Kiểm tra giao diện → Wails → Modbus engine → Analyzer</p></div>
        <button onClick={onClose} className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-500 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {running && <div className="flex items-center gap-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] p-4 text-[11px] text-emerald-100"><CircleDashed className="h-4 w-4 animate-spin" /> Đang chạy kiểm tra bằng simulator nội bộ…</div>}
        {!running && checks.length > 0 && <div className={`mb-4 rounded-xl border p-4 ${failed ? 'border-rose-300/20 bg-rose-300/[.05]' : 'border-emerald-300/20 bg-emerald-300/[.05]'}`}><div className={`text-sm font-bold ${failed ? 'text-rose-200' : 'text-emerald-200'}`}>{failed ? `${failed} bước kiểm tra thất bại` : 'Mọi lớp chức năng đều phản hồi'}</div><div className="mt-1 text-[10px] text-slate-500">Kết quả này không truy cập cổng COM hoặc thiết bị thật.</div></div>}
        <div className="space-y-2">{checks.map((check) => <div key={check.name} className="flex items-start gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className={`mt-0.5 ${check.status === 'pass' ? 'text-emerald-300' : 'text-rose-300'}`}>{check.status === 'pass' ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-slate-200">{check.name}</div><div className="mt-1 break-words text-[10px] leading-4 text-slate-500">{check.detail}</div></div><span className="font-mono text-[9px] text-slate-700">{check.durationMs} ms</span></div>)}</div>
      </div>

      <footer className="flex h-14 shrink-0 items-center border-t border-white/[.08] px-5"><span className="text-[9px] text-slate-600">Không thay đổi session đang sử dụng.</span><button disabled={running} onClick={run} className="ml-auto flex h-9 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-[10px] font-bold text-[#07100e] disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} /> Chạy lại</button></footer>
    </section>
  </div>;
};
