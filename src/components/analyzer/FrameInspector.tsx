import React from 'react';
import { Braces, Clock3, ShieldCheck, TriangleAlert } from 'lucide-react';
import { CapturedModbusFrame } from '../../types/modbus';
import { formatLatency } from './analyzerUtils';

interface FrameInspectorProps {
  selected: CapturedModbusFrame | null;
}

export const FrameInspector: React.FC<FrameInspectorProps> = ({ selected }) => {
  return (
    <aside className="hidden min-h-0 flex-col border-l border-slate-800 bg-[#08111b]/95 xl:flex">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          <Braces className="h-3.5 w-3.5" /> Frame inspector
        </span>
        {selected && <span className="font-mono text-[9px] text-slate-600">#{selected.sequence}</span>}
      </div>
      {!selected ? (
        <div className="grid flex-1 place-items-center text-[11px] text-slate-600">Chọn một frame để phân tích</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${
                  selected.direction === 'master_to_slave'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {selected.direction.replaceAll('_', ' ')}
              </span>
              <span className="text-[9px] uppercase text-slate-600">{selected.capture_quality}</span>
            </div>
            <div className="mt-3 font-mono text-xs font-semibold leading-5 text-slate-100">
              {selected.parsed?.summary || 'Unknown frame'}
            </div>
            <div className="mt-1 text-[10px] text-slate-600">
              Source: {selected.source_id} · {selected.transport.toUpperCase()}
            </div>
          </section>

          <section className="border-b border-slate-800 p-4">
            <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Decoded fields</div>
            <div className="grid grid-cols-[120px_1fr] gap-y-2 text-[10px]">
              <span className="text-slate-600">Message</span>
              <span className="text-slate-300">{selected.parsed?.kind || 'unknown'}</span>
              <span className="text-slate-600">Unit ID</span>
              <span className="font-mono text-cyan-300">{selected.parsed?.unit_id ?? '—'}</span>
              <span className="text-slate-600">Transaction ID</span>
              <span className="font-mono text-slate-300">{selected.parsed?.transaction_id ?? '—'}</span>
              <span className="text-slate-600">Function</span>
              <span className="text-slate-300">
                FC{selected.parsed?.function_code?.toString().padStart(2, '0')} · {selected.parsed?.function_name}
              </span>
              {selected.parsed?.sub_function != null && (
                <>
                  <span className="text-slate-600">Sub-function</span>
                  <span className="font-mono text-amber-300">
                    0x{selected.parsed.sub_function.toString(16).padStart(4, '0').toUpperCase()}
                  </span>
                </>
              )}
              {selected.parsed?.address != null && (
                <>
                  <span className="text-slate-600">Address</span>
                  <span className="font-mono text-slate-300">{selected.parsed.address}</span>
                </>
              )}
              {selected.parsed?.quantity != null && (
                <>
                  <span className="text-slate-600">Quantity</span>
                  <span className="font-mono text-slate-300">{selected.parsed.quantity}</span>
                </>
              )}
              {selected.parsed?.write_address != null && (
                <>
                  <span className="text-slate-600">Write Addr / Qty</span>
                  <span className="font-mono text-amber-300">
                    @{selected.parsed.write_address} ×{selected.parsed.write_quantity}
                  </span>
                </>
              )}
              {selected.parsed?.and_mask != null && (
                <>
                  <span className="text-slate-600">AND Mask</span>
                  <span className="font-mono text-cyan-300">
                    0x{selected.parsed.and_mask.toString(16).padStart(4, '0').toUpperCase()} ({selected.parsed.and_mask})
                  </span>
                </>
              )}
              {selected.parsed?.or_mask != null && (
                <>
                  <span className="text-slate-600">OR Mask</span>
                  <span className="font-mono text-cyan-300">
                    0x{selected.parsed.or_mask.toString(16).padStart(4, '0').toUpperCase()} ({selected.parsed.or_mask})
                  </span>
                </>
              )}
              {selected.parsed?.text_data && (
                <>
                  <span className="text-slate-600">Data / Device ID</span>
                  <span className="font-mono text-amber-300 break-all">{selected.parsed.text_data}</span>
                </>
              )}
              <span className="text-slate-600">Response time</span>
              <span className="font-mono text-emerald-300">{formatLatency(selected.response_time_us)}</span>
              <span className="text-slate-600">Integrity</span>
              <span className="text-slate-300">
                {selected.parsed?.crc_valid === false || selected.parsed?.mbap_valid === false ? 'Invalid' : 'Valid'}
              </span>
            </div>
            {(selected.parsed?.values?.length || 0) > 0 && (
              <div className="mt-3 border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] leading-5 text-amber-200 whitespace-pre-wrap">
                <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Register Values:</div>
                {selected.parsed?.values?.map((v, i) => `R${i}: ${v} (0x${v.toString(16).padStart(4, '0').toUpperCase()})`).join('\n')}
              </div>
            )}
            {(selected.parsed?.engineering_values?.length || 0) > 0 && (
              <div className="mt-3 border border-emerald-900/40 bg-emerald-950/20 p-2.5 font-mono text-[10px]">
                <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mb-1.5 flex items-center justify-between">
                  <span>Biến kỹ thuật (Engineering Values):</span>
                  <span className="text-[8px] text-emerald-500 font-normal">Profile Mapped</span>
                </div>
                <div className="space-y-1">
                  {selected.parsed?.engineering_values?.map((ev, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-emerald-900/30 pb-1">
                      <span className="text-slate-300 font-medium">@{ev.address} {ev.name}:</span>
                      <span className="text-emerald-300 font-bold">{ev.value} <span className="text-emerald-500 font-normal">{ev.unit}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(selected.parsed?.write_values?.length || 0) > 0 && (
              <div className="mt-2 border border-amber-900/30 bg-amber-950/20 p-2 font-mono text-[10px] leading-5 text-amber-300 whitespace-pre-wrap">
                <div className="text-[9px] uppercase tracking-wider text-amber-500 mb-1">Write Values:</div>
                {selected.parsed?.write_values?.map((v, i) => `W${i}: ${v} (0x${v.toString(16).padStart(4, '0').toUpperCase()})`).join('\n')}
              </div>
            )}
            {(selected.parsed?.bits?.length || 0) > 0 && (
              <div className="mt-2 border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] leading-5 text-cyan-300">
                <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Bits:</div>
                <div className="flex flex-wrap gap-1">
                  {selected.parsed?.bits?.map((b, i) => (
                    <span
                      key={i}
                      className={`px-1.5 py-0.5 rounded text-[9px] ${
                        b ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      b{i}:{b ? '1' : '0'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="border-b border-slate-800 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Raw ADU</span>
              <span className="text-[9px] text-slate-700">{selected.raw?.length || 0} bytes</span>
            </div>
            <div className="select-text break-words border border-cyan-950 bg-[#03070c] p-3 font-mono text-[11px] leading-6 tracking-wide text-cyan-200 shadow-inner">
              {selected.hex}
            </div>
          </section>

          <section className="p-4">
            <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Diagnostics</div>
            {(selected.diagnostics?.length || 0) === 0 ? (
              <div className="flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[.06] p-3 text-[10px] text-emerald-300">
                <ShieldCheck className="h-4 w-4" /> Không phát hiện lỗi trên frame này
              </div>
            ) : (
              selected.diagnostics?.map((item, index) => (
                <div key={`${item.rule_id}-${index}`} className="mb-2 border border-rose-500/20 bg-rose-500/[.06] p-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-rose-300">
                    <TriangleAlert className="h-3.5 w-3.5" /> {item.rule_id}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-400">{item.message}</p>
                  {item.recommendation && (
                    <p className="mt-2 border-l border-amber-500/40 pl-2 text-[9px] leading-4 text-amber-200/80">
                      {item.recommendation}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-[9px] text-slate-600">
                    <Clock3 className="h-3 w-3" /> Confidence {item.confidence}%
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </aside>
  );
};
