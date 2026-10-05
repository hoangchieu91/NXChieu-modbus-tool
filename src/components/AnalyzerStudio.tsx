import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualList } from '../utils/useVirtualList';

// Fixed row height so the transaction list can be windowed.
const FRAME_ROW_HEIGHT = 56;
import {
  Activity, ArrowDownLeft, ArrowUpRight, BookOpen, CircleDot, Clock3, Download, FolderOpen,
  Gauge, Layers3, Pause, Play, Radio, RefreshCw, Search, ShieldCheck, Trash2,
  TriangleAlert, TrendingUp, X, Zap,
} from 'lucide-react';
import {
  checkNpcapStatus, clearSniffer, getSnifferSnapshot, getSnifferStatus, openSnifferCapture,
  resetSnifferBaseline, saveSnifferCapture, setSnifferBaselineMode, startSniffer, stopSniffer,
} from '../services/backend';
import {
  CapturedModbusFrame, ModbusDeviceHealth, NpcapStatus, SnifferCaptureConfig, SnifferCaptureStatus,
  SnifferHealthSnapshot, SnifferSnapshot,
} from '../types/modbus';

interface AnalyzerStudioProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenClassic: () => void;
}

const emptyConfig: SnifferCaptureConfig = {
  mode: 'tcp_proxy', listen_host: '0.0.0.0', listen_port: 1502,
  target_host: '127.0.0.1', target_port: 502,
  serial_port: 'COM1', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1,
};

const stateText: Record<string, string> = {
  healthy: 'Ổn định', degraded: 'Cần chú ý', critical: 'Nguy cấp', unknown: 'Chưa có dữ liệu',
  suspected_offline: 'Nghi mất phản hồi', offline: 'Mất phản hồi', not_polled: 'Không được poll',
};

const stateClass: Record<string, string> = {
  healthy: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
  degraded: 'text-amber-200 bg-amber-400/10 border-amber-400/30',
  critical: 'text-rose-200 bg-rose-400/10 border-rose-400/30',
  offline: 'text-rose-200 bg-rose-400/10 border-rose-400/30',
  suspected_offline: 'text-orange-200 bg-orange-400/10 border-orange-400/30',
  not_polled: 'text-slate-300 bg-slate-400/10 border-slate-400/30',
  unknown: 'text-slate-300 bg-slate-400/10 border-slate-400/30',
};

const fmtLatency = (value = 0) => value >= 1_000_000
  ? `${(value / 1_000_000).toFixed(2)} s`
  : value >= 1_000 ? `${(value / 1_000).toFixed(1)} ms` : `${value} µs`;

const issueCount = (frame: CapturedModbusFrame) => frame.diagnostics?.filter((d) => d.severity !== 'info').length || 0;

export const AnalyzerStudio: React.FC<AnalyzerStudioProps> = ({ isOpen, onClose, onOpenClassic }) => {
  const [snapshot, setSnapshot] = useState<SnifferSnapshot | null>(null);
  const [status, setStatus] = useState<SnifferCaptureStatus | null>(null);
  const [selectedID, setSelectedID] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [timeWindow, setTimeWindow] = useState<0 | 1 | 5 | 15>(0);
  const [config, setConfig] = useState<SnifferCaptureConfig>(emptyConfig);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Npcap adapters, loaded when the passive NIC mode is chosen.
  const [npcap, setNpcap] = useState<NpcapStatus | null>(null);
  useEffect(() => {
    if (isOpen && config.mode === 'passive_pcap' && !npcap) {
      checkNpcapStatus().then(setNpcap).catch((error) => setMessage(String(error)));
    }
  }, [isOpen, config.mode, npcap]);

  const refreshing = useRef(false);
  const refresh = async () => {
    if (refreshing.current) return; // never stack overlapping refreshes behind a slow IPC call
    refreshing.current = true;
    try {
      const [nextSnapshot, nextStatus] = await Promise.all([getSnifferSnapshot(2000), getSnifferStatus()]);
      setSnapshot(nextSnapshot);
      setStatus(nextStatus);
    } finally {
      refreshing.current = false;
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh().catch((error) => setMessage(String(error)));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 800);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  const frames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = snapshot?.frames || [];
    const newest = source.reduce((value, frame) => Math.max(value, frame.captured_at_unix_ns || 0), 0);
    const cutoff = timeWindow && newest ? newest - timeWindow * 60 * 1_000_000_000 : 0;
    return [...source].reverse().filter((frame) => {
      if (cutoff && frame.captured_at_unix_ns < cutoff) return false;
      if (selectedUnit !== null && frame.parsed?.unit_id !== selectedUnit) return false;
      if (onlyIssues && issueCount(frame) === 0) return false;
      if (!needle) return true;
      const text = `${frame.timestamp} ${frame.hex} ${frame.parsed?.unit_id ?? ''} ${frame.parsed?.function_name ?? ''} ${frame.parsed?.summary ?? ''}`.toLowerCase();
      return text.includes(needle);
    });
  }, [snapshot, query, selectedUnit, onlyIssues, timeWindow]);

  // Once the user picked a frame, keep it; if it was evicted from the ring buffer, say so instead
  // of silently showing whatever frame is newest now.
  const frameList = useVirtualList(frames, FRAME_ROW_HEIGHT);
  const selectedFrame = selectedID ? snapshot?.frames.find((frame) => frame.id === selectedID) : undefined;
  const selected = selectedID ? selectedFrame : frames[0];
  const selectionEvicted = Boolean(selectedID) && !selectedFrame;
  const health = snapshot?.health;
  const score = health?.score || 0;
  const relatedFrames = useMemo(() => {
    if (!selected) return [];
    if (selected.conversation_id) return (snapshot?.frames || []).filter((frame) => frame.conversation_id === selected.conversation_id);
    return [selected];
  }, [snapshot, selected]);
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setMessage('');
    try { await action(); if (success) setMessage(success); await refresh(); }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] flex flex-col overflow-hidden bg-[#07100e] text-slate-100">
      <header className="flex h-16 shrink-0 items-center border-b border-white/10 bg-[#091713] px-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-300 text-[#07100e] shadow-[0_0_30px_rgba(110,231,183,.18)]"><Zap className="h-5 w-5" /></div>
          <div><div className="text-sm font-bold tracking-tight">Bus Analyzer <span className="ml-1 rounded-full bg-emerald-300/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300">Studio</span></div><div className="text-[10px] text-slate-500">Theo dõi và điều tra giao tiếp Modbus</div></div>
        </div>
        <div className="ml-8 hidden items-center gap-2 lg:flex">
          <span className={`h-2 w-2 rounded-full ${status?.running ? 'animate-pulse bg-emerald-300' : 'bg-slate-600'}`} />
          <span className="text-[11px] text-slate-400">{status?.running ? `Đang thu · ${status.mode}` : 'Chưa chạy phiên thu chủ động'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onOpenClassic} className="flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[11px] text-slate-300 hover:bg-white/5"><Layers3 className="h-4 w-4" /> Analyzer cũ</button>
          <button onClick={() => refresh()} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <HealthOverview health={health} frames={snapshot?.frames || []} />

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(480px,1fr)_340px]">
        <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#091410] p-4">
          <div className="mb-5 rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-300/[.09] to-transparent p-4">
            <div className="flex items-start justify-between"><div><div className="text-[10px] uppercase tracking-[.2em] text-slate-500">Sức khỏe bus</div><div className="mt-1 text-4xl font-black tracking-tight">{score}<span className="text-sm font-normal text-slate-500">/100</span></div></div><Gauge className="h-6 w-6 text-emerald-300" /></div>
            <div className={`mt-4 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${stateClass[health?.state || 'unknown']}`}>{stateText[health?.state || 'unknown']}</div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]"><Metric label="Frames" value={health?.total_frames || 0} /><Metric label="Timeout" value={health?.timeouts || 0} alert={(health?.timeouts || 0) > 0} /><Metric label="CRC" value={health?.crc_error_frames || 0} alert={(health?.crc_error_frames || 0) > 0} /><Metric label="P95" value={fmtLatency(health?.p95_latency_us)} /></div>
          </div>

          <SectionTitle icon={<Radio className="h-3.5 w-3.5" />} text="Nguồn dữ liệu" />
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/10 p-3">
            <select disabled={status?.running} value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as SnifferCaptureConfig['mode'] })} className="h-9 w-full rounded-lg border border-white/10 bg-[#07100e] px-2 text-[11px] outline-none">
              <option value="tcp_proxy">Modbus TCP Proxy</option><option value="rtu_over_tcp_proxy">RTU over TCP Proxy</option><option value="passive_serial">Passive Serial RTU</option><option value="passive_pcap">Passive NIC (Npcap)</option>
            </select>
            {config.mode === 'passive_serial' ? <div className="grid grid-cols-2 gap-2"><Field value={config.serial_port || ''} onChange={(v) => setConfig({ ...config, serial_port: v })} placeholder="COM1" /><Field value={String(config.baud_rate || 9600)} onChange={(v) => setConfig({ ...config, baud_rate: Number(v) })} placeholder="9600" /></div> : config.mode === 'passive_pcap' ? <div className="space-y-2">
              {npcap && !npcap.installed ? <div className="rounded-lg border border-amber-300/20 bg-amber-300/[.06] p-2.5 text-[10px] leading-4 text-amber-100">Chưa cài Npcap. Tải tại npcap.com rồi mở lại Analyzer.</div> : <select disabled={status?.running} value={config.interface_name || ''} onChange={(e) => setConfig({ ...config, interface_name: e.target.value })} className="h-9 w-full rounded-lg border border-white/10 bg-[#07100e] px-2 text-[11px] outline-none"><option value="">-- Chọn card mạng --</option>{(npcap?.interfaces || []).map((nic) => <option key={nic.name} value={nic.name}>{nic.description || nic.name}{nic.ips?.length ? ` (${nic.ips[0]})` : ''}</option>)}</select>}
              <Field value={config.bpf_filter || 'tcp port 502'} onChange={(v) => setConfig({ ...config, bpf_filter: v })} placeholder="tcp port 502" />
            </div> : <><div className="grid grid-cols-2 gap-2"><Field value={String(config.listen_port || 1502)} onChange={(v) => setConfig({ ...config, listen_port: Number(v) })} placeholder="Listen" /><Field value={String(config.target_port || 502)} onChange={(v) => setConfig({ ...config, target_port: Number(v) })} placeholder="Target port" /></div><Field value={config.target_host || ''} onChange={(v) => setConfig({ ...config, target_host: v })} placeholder="Target host" /></>}
            {status?.running ? <button disabled={busy} onClick={() => run(stopSniffer, 'Đã dừng phiên thu')} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-rose-400/15 text-[11px] font-semibold text-rose-200"><Pause className="h-3.5 w-3.5" /> Dừng thu</button> : <button disabled={busy || (config.mode === 'passive_pcap' && !config.interface_name)} onClick={() => run(() => startSniffer(config), 'Đã bắt đầu phiên thu')} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 text-[11px] font-bold text-[#07100e] disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-3.5 w-3.5 fill-current" /> Bắt đầu thu</button>}
          </div>

          <SectionTitle icon={<Activity className="h-3.5 w-3.5" />} text="Thiết bị quan sát được" />
          <div className="space-y-1.5">
            {(health?.devices || []).map((device) => <DeviceCard key={device.unit_id} device={device} selected={selectedUnit === device.unit_id} onClick={() => setSelectedUnit(selectedUnit === device.unit_id ? null : device.unit_id)} />)}
            {(health?.devices || []).length === 0 && <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[10px] leading-5 text-slate-600">Chưa thấy thiết bị trên bus</div>}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col bg-[#07100e]">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-4">
            <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-600" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm Unit, function, địa chỉ hoặc hex..." className="h-9 w-full rounded-xl border border-white/10 bg-white/[.025] pl-10 pr-3 text-[11px] outline-none focus:border-emerald-300/40" /></div>
            <button onClick={() => setOnlyIssues(!onlyIssues)} className={`flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] ${onlyIssues ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : 'border-white/10 text-slate-400'}`}><TriangleAlert className="h-3.5 w-3.5" /> Chỉ sự cố</button>
            <div className="flex h-9 items-center rounded-xl border border-white/10 bg-black/10 p-0.5">
              <Clock3 className="mx-2 h-3.5 w-3.5 text-slate-600" />
              {([0, 1, 5, 15] as const).map((minutes) => <button key={minutes} onClick={() => setTimeWindow(minutes)} className={`h-7 rounded-lg px-2 text-[9px] ${timeWindow === minutes ? 'bg-emerald-300 text-[#07100e]' : 'text-slate-500 hover:text-slate-200'}`}>{minutes === 0 ? 'Tất cả' : `${minutes}m`}</button>)}
            </div>
            {selectedUnit !== null && <button onClick={() => setSelectedUnit(null)} className="h-9 rounded-xl border border-emerald-300/30 px-3 text-[10px] text-emerald-200">Unit {selectedUnit} ×</button>}
          </div>
          <div className="grid h-9 shrink-0 grid-cols-[72px_42px_74px_1fr_88px_34px] items-center border-b border-white/10 px-4 text-[9px] font-semibold uppercase tracking-wider text-slate-600"><span>Thời gian</span><span>Unit</span><span>Chiều</span><span>Giao dịch</span><span>Độ trễ</span><span /></div>
          <div ref={frameList.ref} className="min-h-0 flex-1 overflow-y-auto">
            {frames.length > 0 && (
              <div style={{ height: frameList.totalHeight, position: 'relative' }}>
                <div style={{ transform: `translateY(${frameList.offsetTop}px)` }}>
                  {frameList.visible.map((frame) => <FrameRow key={frame.id} frame={frame} active={selected?.id === frame.id} onClick={() => setSelectedID(frame.id)} />)}
                </div>
              </div>
            )}
            {frames.length === 0 && <div className="grid h-full place-items-center"><div className="text-center"><CircleDot className="mx-auto h-8 w-8 text-slate-700" /><div className="mt-3 text-xs text-slate-500">Chưa có giao dịch phù hợp</div><div className="mt-1 text-[10px] text-slate-700">Kết nối, mở capture hoặc đổi bộ lọc</div></div></div>}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[#0a1512]">
          <div className="border-b border-white/10 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Chi tiết giao dịch</div>{selected ? <><div className="mt-3 flex items-center gap-2"><span className="rounded-lg bg-emerald-300 px-2 py-1 text-[10px] font-black text-[#07100e]">Unit {selected.parsed?.unit_id ?? '—'}</span><span className="text-xs font-semibold">FC{String(selected.parsed?.function_code ?? 0).padStart(2, '0')} · {selected.parsed?.function_name || 'Không giải mã'}</span></div><p className="mt-2 text-[11px] leading-5 text-slate-400">{selected.parsed?.summary || 'Khung tin chưa có mô tả'}</p></> : <div className="mt-3 text-[11px] text-slate-600">{selectionEvicted ? 'Giao dịch đã chọn không còn trong bộ đệm (đã bị frame mới đẩy ra).' : 'Chọn một giao dịch để xem.'}</div>}</div>
          {selected && <>
            <div className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/10"><Detail label="Nguồn" value={selected.capture_source || selected.source_id} /><Detail label="Chất lượng" value={selected.capture_quality} /><Detail label="Địa chỉ" value={selected.parsed?.address ?? selected.parsed?.write_address ?? '—'} /><Detail label="Số lượng" value={selected.parsed?.quantity ?? selected.parsed?.write_quantity ?? '—'} /><Detail label="Transaction" value={selected.conversation_id || '—'} /><Detail label="Phản hồi" value={fmtLatency(selected.response_time_us)} /></div>
            <Panel title="Chuỗi Master ↔ Slave"><ConversationFlow frames={relatedFrames} /></Panel>
            {(selected.parsed?.engineering_values?.length || 0) > 0 && <Panel title="Giá trị kỹ thuật">{selected.parsed?.engineering_values?.map((value) => <div key={`${value.address}-${value.name}`} className="flex items-center justify-between border-b border-white/[.06] py-2 last:border-0"><div><div className="text-[11px] text-slate-200">{value.name}</div><div className="text-[9px] text-slate-600">Register {value.address}</div></div><div className="font-mono text-sm font-bold text-emerald-300">{value.value} <span className="text-[10px] font-normal text-slate-500">{value.unit}</span></div></div>)}</Panel>}
            <Panel title="Raw ADU"><div className="select-text break-all rounded-lg bg-black/25 p-3 font-mono text-[10px] leading-5 text-emerald-200/80">{selected.hex}</div></Panel>
            <Panel title="Chẩn đoán">{(selected.diagnostics?.length || 0) === 0 ? <div className="flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-300/[.05] p-3 text-[10px] text-emerald-200"><ShieldCheck className="h-4 w-4" /> Không phát hiện lỗi trên frame</div> : selected.diagnostics?.map((item, index) => <div key={`${item.rule_id}-${index}`} className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/[.05] p-3"><div className="text-[10px] font-bold text-amber-200">{item.rule_id}</div><div className="mt-1 text-[10px] leading-4 text-slate-400">{item.message}</div>{item.recommendation && <div className="mt-2 text-[9px] leading-4 text-emerald-200/70">→ {item.recommendation}</div>}</div>)}</Panel>
          </>}
        </aside>
      </div>

      <footer className="flex h-11 shrink-0 items-center gap-2 border-t border-white/10 bg-[#091410] px-4">
        <button disabled={busy} onClick={() => run(openSnifferCapture, 'Đã mở capture')} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] text-slate-300 hover:bg-white/5 disabled:opacity-40"><FolderOpen className="h-3.5 w-3.5" /> Mở capture</button>
        <button disabled={busy} onClick={() => run(saveSnifferCapture, 'Đã lưu capture cùng baseline/profile')} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] text-slate-300 hover:bg-white/5 disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Lưu capture</button>
        <button disabled={busy} onClick={() => run(clearSniffer, 'Đã xóa dữ liệu phiên')} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] text-rose-200 hover:bg-white/5 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> Xóa phiên</button>
        <div className="mx-2 h-5 w-px bg-white/10" />
        <span className="text-[9px] uppercase tracking-wider text-slate-600">Baseline</span>
        {(['off', 'learn', 'monitor'] as const).map((mode) => <button key={mode} disabled={busy} onClick={() => run(() => setSnifferBaselineMode(mode), `Baseline: ${mode}`)} className={`h-7 rounded-lg px-2 text-[9px] uppercase ${snapshot?.baseline?.mode === mode ? 'bg-emerald-300 text-[#07100e]' : 'border border-white/10 text-slate-500'}`}>{mode}</button>)}
        <button disabled={busy} onClick={() => run(resetSnifferBaseline, 'Đã học lại baseline')} className="h-7 px-2 text-[9px] text-slate-500 hover:text-white"><BookOpen className="mr-1 inline h-3 w-3" />Reset</button>
        <div className={`ml-auto max-w-[420px] truncate text-[10px] ${message.toLowerCase().includes('error') || message.toLowerCase().includes('lỗi') ? 'text-rose-300' : 'text-slate-500'}`}>{message || `${frames.length} giao dịch hiển thị · ${health?.devices?.length || 0} thiết bị`}</div>
      </footer>
    </div>
  );
};

const HealthOverview = ({ health, frames }: { health?: SnifferHealthSnapshot; frames: CapturedModbusFrame[] }) => {
  const buckets = useMemo(() => {
    const size = 24;
    const result = Array.from({ length: size }, () => ({ frames: 0, issues: 0, latency: 0 }));
    if (frames.length === 0) return result;
    frames.forEach((frame, index) => {
      const bucket = result[Math.min(size - 1, Math.floor(index * size / frames.length))];
      bucket.frames += 1;
      bucket.issues += issueCount(frame);
      bucket.latency = Math.max(bucket.latency, frame.response_time_us || 0);
    });
    return result;
  }, [frames]);
  const maxFrames = Math.max(1, ...buckets.map((bucket) => bucket.frames));
  const offline = health?.devices.filter((device) => device.state.includes('offline')).length || 0;
  const integrity = (health?.crc_error_frames || 0) + (health?.malformed_frames || 0);
  const recommendations = [
    offline > 0 ? `${offline} thiết bị có dấu hiệu mất phản hồi` : '',
    (health?.timeouts || 0) > 0 ? `${health?.timeouts} timeout — kiểm tra tải bus và termination` : '',
    integrity > 0 ? `${integrity} lỗi toàn vẹn — kiểm tra nhiễu, baud và dây dẫn` : '',
    (health?.orphan_responses || 0) > 0 ? `${health?.orphan_responses} response không ghép được request` : '',
  ].filter(Boolean);

  return <section className="grid h-[108px] shrink-0 grid-cols-[170px_1fr_330px] border-b border-white/10 bg-[#08120f]">
    <div className="flex items-center gap-3 border-r border-white/[.07] px-5"><div className={`grid h-14 w-14 place-items-center rounded-2xl border text-xl font-black ${health?.state === 'critical' ? 'border-rose-300/30 bg-rose-300/10 text-rose-200' : health?.state === 'degraded' ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'}`}>{health?.score || 0}</div><div><div className="text-[9px] uppercase tracking-[.18em] text-slate-600">Bus health</div><div className="mt-1 text-xs font-semibold text-slate-200">{stateText[health?.state || 'unknown']}</div><div className="mt-1 text-[9px] text-slate-600">{health?.devices.length || 0} thiết bị</div></div></div>
    <div className="flex min-w-0 flex-col justify-center border-r border-white/[.07] px-5"><div className="mb-2 flex items-center"><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">Timeline hoạt động</div><div className="ml-auto flex gap-3 text-[8px] text-slate-600"><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />Bình thường</span><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />Có cảnh báo</span></div></div><div className="flex h-12 items-end gap-1">{buckets.map((bucket, index) => <div key={index} className="group relative flex h-full flex-1 items-end"><div title={`${bucket.frames} frame · ${bucket.issues} cảnh báo · max ${fmtLatency(bucket.latency)}`} style={{ height: `${Math.max(8, bucket.frames / maxFrames * 100)}%` }} className={`w-full rounded-sm transition group-hover:brightness-150 ${bucket.issues > 0 ? 'bg-amber-300/70' : bucket.frames > 0 ? 'bg-emerald-300/45' : 'bg-white/[.04]'}`} /></div>)}</div></div>
    <div className="flex min-w-0 items-center px-4"><div className="min-w-0 flex-1"><div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600"><TrendingUp className="h-3.5 w-3.5" />Nhận định nhanh</div>{recommendations.length > 0 ? <div className="space-y-1">{recommendations.slice(0, 3).map((item) => <div key={item} className="truncate text-[9px] text-amber-100/80">• {item}</div>)}</div> : <div className="flex items-center gap-2 text-[10px] text-emerald-200/70"><ShieldCheck className="h-4 w-4" /> Chưa thấy bất thường đáng kể</div>}</div></div>
  </section>;
};

const Metric = ({ label, value, alert }: { label: string; value: React.ReactNode; alert?: boolean }) => <div className="rounded-lg bg-black/15 p-2"><div className="text-slate-600">{label}</div><div className={`mt-0.5 font-mono text-xs font-bold ${alert ? 'text-rose-300' : 'text-slate-200'}`}>{value}</div></div>;
const SectionTitle = ({ icon, text }: { icon: React.ReactNode; text: string }) => <div className="mb-2 mt-5 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">{icon}{text}</div>;
const Field = ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 min-w-0 rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] outline-none focus:border-emerald-300/30" />;
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="border-b border-white/10 p-4"><div className="mb-3 text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">{title}</div>{children}</section>;
const Detail = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="bg-[#0a1512] p-3"><div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-300">{value}</div></div>;

const DeviceCard = ({ device, selected, onClick }: { device: ModbusDeviceHealth; selected: boolean; onClick: () => void }) => <button onClick={onClick} className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-emerald-300/40 bg-emerald-300/[.08]' : 'border-white/[.07] bg-white/[.02] hover:border-white/15'}`}><div className="flex items-center justify-between"><span className="text-xs font-bold">Unit {device.unit_id}</span><span className={`h-2 w-2 rounded-full ${device.state === 'healthy' ? 'bg-emerald-300' : device.state.includes('offline') ? 'bg-rose-300' : 'bg-amber-300'}`} /></div><div className="mt-2 flex items-center justify-between text-[9px] text-slate-600"><span>{stateText[device.state] || device.state}</span><span>{device.success_rate.toFixed(1)}% · {fmtLatency(device.p95_latency_us)}</span></div></button>;

const ConversationFlow = ({ frames }: { frames: CapturedModbusFrame[] }) => {
  const ordered = [...frames].sort((a, b) => a.sequence - b.sequence);
  return <div className="space-y-2">{ordered.slice(-4).map((frame, index) => <div key={frame.id} className="relative flex gap-2"><div className="flex w-5 flex-col items-center"><div className={`grid h-5 w-5 place-items-center rounded-full ${frame.direction === 'master_to_slave' ? 'bg-cyan-300/15 text-cyan-200' : 'bg-violet-300/15 text-violet-200'}`}>{frame.direction === 'master_to_slave' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}</div>{index < ordered.slice(-4).length - 1 && <div className="mt-1 h-full w-px bg-white/10" />}</div><div className="min-w-0 flex-1 pb-2"><div className="flex items-center gap-2"><span className="text-[9px] font-semibold text-slate-300">{frame.parsed?.kind === 'request' ? 'Master gửi yêu cầu' : frame.parsed?.kind === 'exception' ? 'Slave trả exception' : 'Slave phản hồi'}</span><span className="ml-auto font-mono text-[8px] text-slate-600">{frame.timestamp}</span></div><div className="mt-0.5 truncate text-[9px] text-slate-600">{frame.parsed?.summary || frame.hex}</div></div></div>)}{ordered.length === 1 && ordered[0].parsed?.kind === 'request' && <div className="rounded-lg border border-amber-300/20 bg-amber-300/[.05] p-2 text-[9px] text-amber-100">Đang chờ hoặc không tìm thấy phản hồi tương ứng.</div>}</div>;
};

const FrameRow = ({ frame, active, onClick }: { frame: CapturedModbusFrame; active: boolean; onClick: () => void }) => {
  const issues = issueCount(frame);
  return <button onClick={onClick} style={{ height: FRAME_ROW_HEIGHT }} className={`grid w-full overflow-hidden grid-cols-[72px_42px_74px_1fr_88px_34px] items-center border-b px-4 text-left transition ${active ? 'border-emerald-300/20 bg-emerald-300/[.07]' : 'border-white/[.055] hover:bg-white/[.025]'}`}><span className="font-mono text-[10px] text-slate-500">{frame.timestamp}</span><span className="font-mono text-xs font-bold text-slate-200">{frame.parsed?.unit_id ?? '—'}</span><span className={`flex items-center gap-1 text-[9px] ${frame.direction === 'master_to_slave' ? 'text-cyan-300' : 'text-violet-300'}`}>{frame.direction === 'master_to_slave' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}{frame.direction === 'master_to_slave' ? 'REQUEST' : 'RESPONSE'}</span><span className="min-w-0 pr-3"><span className="block truncate text-[11px] font-medium text-slate-200">FC{String(frame.parsed?.function_code ?? 0).padStart(2, '0')} · {frame.parsed?.function_name || 'Khung chưa giải mã'}</span><span className="mt-0.5 block truncate text-[9px] text-slate-600">{frame.parsed?.summary || frame.hex}</span></span><span className="font-mono text-[10px] text-slate-400">{frame.response_time_us ? fmtLatency(frame.response_time_us) : '—'}</span><span>{issues > 0 ? <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-amber-300/15 text-[9px] font-bold text-amber-200">{issues}</span> : <ShieldCheck className="h-4 w-4 text-emerald-400/40" />}</span></button>;
};
