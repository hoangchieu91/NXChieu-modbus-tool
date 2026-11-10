import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualList } from '../utils/useVirtualList';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitCompare,
  Info,
  Network,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Target,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  checkNpcapStatus,
  clearSniffer,
  compareSnifferCaptures,
  exportSnifferCSV,
  exportSnifferHTMLReport,
  getSnifferProfileCatalog,
  getSnifferSnapshot,
  getSnifferStatus,
  loadSnifferProfileFile,
  openSnifferCapture,
  pickCaptureFile,
  resetSnifferBaseline,
  saveSnifferCapture,
  setSnifferBaselineMode,
  startSniffer,
  stopSniffer,
} from '../services/backend';
import {
  CaptureDiffResult,
  NpcapStatus,
  ShiftReportOptions,
  SnifferCaptureConfig,
  SnifferCaptureStatus,
  SnifferSnapshot,
} from '../types/modbus';
import { CaptureDiffModal } from './analyzer/CaptureDiffModal';
import { ShiftReportModal } from './analyzer/ShiftReportModal';
import { DeviceRow } from './analyzer/DeviceRow';
import { FrameInspector } from './analyzer/FrameInspector';
import {
  FRAME_ROW_HEIGHT,
  stateTone,
  stateLabel,
  formatLatency,
} from './analyzer/analyzerUtils';

interface ProtocolAnalyzerProps {
  isOpen: boolean;
  onClose: () => void;
}

const Metric: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent = 'text-slate-100' }) => (
  <div className="border-l border-slate-700/80 pl-3 min-w-0">
    <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 whitespace-nowrap">{label}</div>
    <div className={`mt-0.5 text-sm font-semibold font-mono ${accent}`}>{value}</div>
  </div>
);

export const ProtocolAnalyzer: React.FC<ProtocolAnalyzerProps> = ({ isOpen, onClose }) => {
  const [snapshot, setSnapshot] = useState<SnifferSnapshot | null>(null);
  const [selectedFrameID, setSelectedFrameID] = useState<string>('');
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [viewMode, setViewMode] = useState<'frames' | 'transactions'>('frames');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<SnifferCaptureStatus | null>(null);
  const [captureConfig, setCaptureConfig] = useState<SnifferCaptureConfig>({
    mode: 'tcp_proxy', listen_host: '0.0.0.0', listen_port: 1502, target_host: '127.0.0.1', target_port: 502,
    serial_port: 'COM3', baud_rate: 9600, data_bits: 8, parity: 'even', stop_bits: 1,
    interface_name: '', bpf_filter: 'tcp port 502',
  });

  const [profileName, setProfileName] = useState<string>('');
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [diffPathA, setDiffPathA] = useState('');
  const [diffPathB, setDiffPathB] = useState('');
  const [diffResult, setDiffResult] = useState<CaptureDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportOpts, setReportOpts] = useState<ShiftReportOptions>({
    title: 'BÁO CÁO SỨC KHỎE MẠNG TRUYỀN THÔNG MODBUS',
    operator: 'Kỹ sư Vận hành',
    shift: 'Ca 1',
    notes: 'Giám sát định kỳ bus truyền thông',
  });
  const [reportSuccess, setReportSuccess] = useState('');

  const [npcapStatus, setNpcapStatus] = useState<NpcapStatus | null>(null);

  // Capture errors come from the periodic status; action errors (profile, diff, report) are kept
  // separately so the next refresh does not erase them.
  const [captureError, setCaptureError] = useState('');
  const refreshing = useRef(false);
  const refresh = async () => {
    if (refreshing.current) return; // a slow IPC call must not stack up overlapping refreshes
    refreshing.current = true;
    try {
      const [next, status] = await Promise.all([getSnifferSnapshot(1500), getSnifferStatus()]);
      setSnapshot(next);
      setCaptureStatus(status);
      setCaptureError(status.last_error || '');
      // Functional update: the interval keeps the first render's closure, where the selection
      // was always empty, which made the inspector jump to the newest frame every tick.
      if (next.frames.length > 0) {
        const newest = next.frames[next.frames.length - 1].id;
        setSelectedFrameID((current) => current || newest);
      }
    } catch (err) {
      setCaptureError(`Không đọc được analyzer: ${err}`);
    } finally {
      refreshing.current = false;
    }
  };

  const handleLoadProfile = async () => {
    try {
      const path = await loadSnifferProfileFile();
      if (path) {
        const cat = await getSnifferProfileCatalog();
        setProfileName(cat?.name || 'Profile đã nạp');
        await refresh();
      }
    } catch (err) {
      setError(`Lỗi nạp profile: ${err}`);
    }
  };

  const handleSelectDiffFileA = async () => {
    try {
      const path = await pickCaptureFile('Chọn file Capture A (Baseline / Trước)');
      if (path) setDiffPathA(path);
    } catch (err) {
      setError(`Lỗi chọn file A: ${err}`);
    }
  };

  const handleSelectDiffFileB = async () => {
    try {
      const path = await pickCaptureFile('Chọn file Capture B (Target / Hiện tại)');
      if (path) setDiffPathB(path);
    } catch (err) {
      setError(`Lỗi chọn file B: ${err}`);
    }
  };

  const handleRunDiff = async () => {
    if (!diffPathA || !diffPathB) {
      setError('Vui lòng chọn đủ 2 tệp capture (.nxcap) để so sánh');
      return;
    }
    setDiffLoading(true);
    try {
      const res = await compareSnifferCaptures(diffPathA, diffPathB);
      setDiffResult(res);
      setError('');
    } catch (err) {
      setError(`Lỗi phân tích so sánh: ${err}`);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleExportReport = async () => {
    try {
      const path = await exportSnifferHTMLReport(reportOpts);
      if (path) {
        setReportSuccess(`Đã xuất báo cáo HTML: ${path}`);
        setShowReportModal(false);
        setTimeout(() => setReportSuccess(''), 6000);
      }
    } catch (err) {
      setError(`Lỗi xuất báo cáo HTML: ${err}`);
    }
  };

  const handleCheckNpcap = async () => {
    try {
      const status = await checkNpcapStatus();
      setNpcapStatus(status);
      if (status.interfaces?.length > 0 && !captureConfig.interface_name) {
        setCaptureConfig((c) => ({ ...c, interface_name: status.interfaces[0].name }));
      }
    } catch (err) {
      console.warn('Check Npcap error:', err);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    getSnifferProfileCatalog().then((cat) => {
      if (cat?.name) setProfileName(cat.name);
    }).catch(() => {});
    checkNpcapStatus().then((st) => setNpcapStatus(st)).catch(() => {});
    const timer = window.setInterval(refresh, 750);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  const frames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(snapshot?.frames || [])]
      .filter((frame) => selectedUnit == null || frame.parsed?.unit_id === selectedUnit)
      .filter((frame) => !onlyIssues || (frame.diagnostics?.length || 0) > 0 || frame.parsed?.kind === 'exception')
      .filter((frame) => {
        if (!needle) return true;
        const searchable = [frame.hex, frame.source_id, frame.transport, frame.parsed?.summary, frame.parsed?.function_name, frame.parsed?.unit_id]
          .join(' ')
          .toLowerCase();
        return searchable.includes(needle);
      })
      .reverse();
  }, [snapshot, query, onlyIssues, selectedUnit]);

  const displayRows = useMemo(() => {
    if (viewMode === 'frames') return frames.map((frame) => ({ key: frame.id, frame, summary: frame.parsed?.summary || 'Không giải mã được' }));
    // Push into the group instead of copying it per frame (that was O(n^2) on every refresh).
    const groups = new Map<string, typeof frames>();
    for (const frame of frames) {
      const key = frame.conversation_id || frame.id;
      const group = groups.get(key);
      if (group) group.push(frame);
      else groups.set(key, [frame]);
    }
    return [...groups.entries()].map(([key, group]) => {
      const request = group.find((item) => item.direction === 'master_to_slave');
      const response = group.find((item) => item.direction === 'slave_to_master');
      const frame = response || request || group[0];
      const outcome = response?.parsed?.kind === 'exception' ? 'EXCEPTION' : response ? 'OK' : 'PENDING / TIMEOUT';
      return { key, frame, summary: `${request?.parsed?.summary || frame.parsed?.summary || 'Transaction'} → ${outcome}` };
    });
  }, [frames, viewMode]);
  const frameList = useVirtualList(displayRows, FRAME_ROW_HEIGHT);

  const selected = snapshot?.frames.find((frame) => frame.id === selectedFrameID) || frames[0];
  const health = snapshot?.health;
  const score = health?.score || 0;
  const scoreColour = health?.state === 'critical' ? '#fb7185' : health?.state === 'degraded' ? '#fbbf24' : health?.state === 'healthy' ? '#34d399' : '#475569';

  const handleClear = async () => {
    setLoading(true);
    try {
      await clearSniffer();
      setSelectedFrameID('');
      setSelectedUnit(null);
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    setLoading(true);
    try {
      await action();
      setError('');
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (key: keyof SnifferCaptureConfig, value: string | number) => setCaptureConfig((current) => ({ ...current, [key]: value }));

  const handleToggleBaseline = async () => {
    const currentMode = snapshot?.baseline?.mode || 'learn';
    const nextMode = currentMode === 'monitor' ? 'learn' : 'monitor';
    try {
      await setSnifferBaselineMode(nextMode);
      await refresh();
    } catch (err) {
      setError(`Lỗi đổi baseline mode: ${err}`);
    }
  };

  const handleResetBaseline = async () => {
    try {
      await resetSnifferBaseline();
      await refresh();
    } catch (err) {
      setError(`Lỗi reset baseline: ${err}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#05090f] text-slate-200">
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)] [background-size:28px_28px]" />

      <header className="relative flex h-[76px] shrink-0 items-center border-b border-cyan-950 bg-[#07111b]/95 px-5 shadow-[0_12px_40px_rgba(0,0,0,.35)]">
        <div className="flex min-w-[300px] items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center border border-cyan-500/40 bg-cyan-400/10 text-cyan-300">
            <Activity className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_14px_#34d399]" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-black uppercase tracking-[0.16em] text-slate-50">Protocol Analyzer</h1>
              <span className="text-[9px] font-mono text-cyan-400">LIVE ANALYZER</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">MODBUS TRAFFIC · TRANSACTIONS · BUS HEALTH</p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center gap-6">
          <Metric label="Frames" value={health?.total_frames ?? 0} />
          <Metric label="Requests" value={health?.requests ?? 0} accent="text-sky-300" />
          <Metric label="Responses" value={health?.responses ?? 0} accent="text-emerald-300" />
          <Metric label="P95 latency" value={formatLatency(health?.p95_latency_us)} />
          <Metric label="Integrity errors" value={(health?.crc_error_frames || 0) + (health?.malformed_frames || 0)} accent={(health?.crc_error_frames || 0) > 0 ? 'text-rose-300' : 'text-slate-100'} />
          <Metric
            label="Baseline"
            value={
              <div className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-full ${snapshot?.baseline?.mode === 'monitor' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : snapshot?.baseline?.mode === 'learn' ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-xs">
                  {snapshot?.baseline?.mode === 'monitor' ? 'Monitor' : snapshot?.baseline?.mode === 'learn' ? `Learn (${snapshot.baseline?.sample_frames || 0})` : 'Off'}
                </span>
              </div>
            }
            accent={snapshot?.baseline?.mode === 'monitor' ? 'text-emerald-300' : snapshot?.baseline?.mode === 'learn' ? 'text-amber-300' : 'text-slate-400'}
          />
        </div>

        <div className="flex min-w-[340px] items-center justify-end gap-2">
          <button
            onClick={handleToggleBaseline}
            title={snapshot?.baseline?.mode === 'monitor' ? 'Chuyển sang chế độ Học Baseline (Learn)' : 'Chuyển sang chế độ Giám sát Baseline (Monitor)'}
            className={`flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-wide transition ${
              snapshot?.baseline?.mode === 'monitor'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                : snapshot?.baseline?.mode === 'learn'
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
            {snapshot?.baseline?.mode === 'monitor' ? 'Monitoring' : snapshot?.baseline?.mode === 'learn' ? 'Learning' : 'Baseline'}
          </button>
          <button
            onClick={handleResetBaseline}
            className="grid h-8 w-8 place-items-center border border-slate-700 text-slate-400 hover:border-amber-500/50 hover:text-amber-300"
            title="Reset học lại Baseline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleLoadProfile}
            title={profileName ? `Profile: ${profileName} (Click để nạp lại)` : 'Nạp Profile thanh ghi thiết bị (.nxprof / .json)'}
            className={`flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-wide transition ${
              profileName ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" /> {profileName ? profileName.slice(0, 12) : 'Profile'}
          </button>
          <button
            onClick={() => setShowDiffModal(true)}
            className="flex h-8 items-center gap-1.5 border border-slate-700 px-2.5 text-[10px] uppercase tracking-wide text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300"
            title="So sánh 2 bản capture Modbus (Diff Analyzer)"
          >
            <GitCompare className="h-3.5 w-3.5" /> Diff
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            className="flex h-8 items-center gap-1.5 border border-slate-700 px-2.5 text-[10px] uppercase tracking-wide text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300"
            title="Xuất báo cáo ca trực định dạng HTML (Shift Health Report)"
          >
            <FileText className="h-3.5 w-3.5" /> Báo cáo
          </button>
          <button onClick={() => setShowCapture(!showCapture)} className={`flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-wide ${captureStatus?.running ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-cyan-700/60 text-cyan-300'}`}>
            <Network className="h-3.5 w-3.5" /> {captureStatus?.running ? 'Capturing' : 'Capture'}
          </button>
          <button onClick={refresh} className="grid h-8 w-8 place-items-center border border-slate-700 text-slate-400 hover:border-cyan-500/60 hover:text-cyan-300" title="Làm mới">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleClear} disabled={loading} className="flex h-8 items-center gap-1.5 border border-slate-700 px-2.5 text-[10px] uppercase tracking-wide text-slate-400 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white" title="Đóng analyzer">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {showCapture && (
        <div className="relative z-20 flex shrink-0 items-end gap-3 border-b border-cyan-950 bg-[#09141f] px-5 py-3 shadow-xl flex-wrap">
          <label className="text-[9px] uppercase tracking-wider text-slate-500">Mode
            <select disabled={captureStatus?.running} value={captureConfig.mode} onChange={(e) => updateConfig('mode', e.target.value)} className="mt-1 block h-8 border border-slate-700 bg-slate-950 px-2 text-[11px] normal-case text-slate-200">
              <option value="tcp_proxy">Modbus TCP Proxy</option>
              <option value="rtu_over_tcp_proxy">RTU over TCP Proxy</option>
              <option value="passive_serial">Passive Serial RTU</option>
              <option value="passive_pcap">Passive NIC (Npcap)</option>
            </select>
          </label>
          {captureConfig.mode === 'passive_serial' ? <>
            <label className="text-[9px] uppercase text-slate-500">COM<input disabled={captureStatus?.running} value={captureConfig.serial_port} onChange={(e) => updateConfig('serial_port', e.target.value)} className="mt-1 block h-8 w-24 border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200" /></label>
            <label className="text-[9px] uppercase text-slate-500">Baud<input disabled={captureStatus?.running} type="number" value={captureConfig.baud_rate} onChange={(e) => updateConfig('baud_rate', Number(e.target.value))} className="mt-1 block h-8 w-24 border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200" /></label>
            <label className="text-[9px] uppercase text-slate-500">Parity<select disabled={captureStatus?.running} value={captureConfig.parity} onChange={(e) => updateConfig('parity', e.target.value)} className="mt-1 block h-8 border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200"><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option></select></label>
          </> : captureConfig.mode === 'passive_pcap' ? <>
            <label className="text-[9px] uppercase text-slate-500">Card mạng (NIC)
              <select
                disabled={captureStatus?.running}
                value={captureConfig.interface_name || ''}
                onChange={(e) => updateConfig('interface_name', e.target.value)}
                className="mt-1 block h-8 border border-slate-700 bg-slate-950 px-2 text-[11px] normal-case text-slate-200 max-w-[220px]"
              >
                <option value="">-- Chọn Interface --</option>
                {(npcapStatus?.interfaces || []).map((iface) => (
                  <option key={iface.index} value={iface.name}>
                    {iface.description || iface.name} {iface.ips && iface.ips.length > 0 ? `(${iface.ips[0]})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[9px] uppercase text-slate-500">BPF Filter
              <input
                disabled={captureStatus?.running}
                value={captureConfig.bpf_filter || 'tcp port 502'}
                onChange={(e) => updateConfig('bpf_filter', e.target.value)}
                className="mt-1 block h-8 w-32 border border-slate-700 bg-slate-950 px-2 text-[11px] normal-case text-slate-200"
              />
            </label>
            <button
              type="button"
              onClick={handleCheckNpcap}
              className={`h-8 border px-2.5 text-[10px] flex items-center gap-1.5 transition ${
                npcapStatus?.installed ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300 hover:border-amber-400'
              }`}
              title={npcapStatus?.installed ? 'Đã phát hiện Npcap: bắt gói thụ động Modbus TCP trên card mạng đã chọn' : 'Chưa cài Npcap driver'}
            >
              <Info className="h-3 w-3" /> Npcap: {npcapStatus?.installed ? 'Đã phát hiện' : 'Chưa cài đặt'}
            </button>
            {!npcapStatus?.installed && (
              <a
                href={npcapStatus?.download_url || 'https://npcap.com/#download'}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 items-center gap-1 border border-cyan-800/80 bg-cyan-950/40 px-2 text-[10px] text-cyan-300 hover:text-white"
                title="Tải Npcap driver từ trang chủ"
              >
                <ExternalLink className="h-3 w-3" /> Tải Npcap
              </a>
            )}
            <div className="max-w-sm border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-4 text-amber-200">
              Passive NIC chưa bắt packet trong bản này. Hãy dùng TCP Proxy hoặc Passive Serial để số liệu phản ánh lưu lượng thật.
            </div>
          </> : <>
            <label className="text-[9px] uppercase text-slate-500">Listen port<input disabled={captureStatus?.running} type="number" value={captureConfig.listen_port} onChange={(e) => updateConfig('listen_port', Number(e.target.value))} className="mt-1 block h-8 w-24 border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200" /></label>
            <label className="text-[9px] uppercase text-slate-500">Target host<input disabled={captureStatus?.running} value={captureConfig.target_host} onChange={(e) => updateConfig('target_host', e.target.value)} className="mt-1 block h-8 w-36 border border-slate-700 bg-slate-950 px-2 text-[11px] normal-case text-slate-200" /></label>
            <label className="text-[9px] uppercase text-slate-500">Target port<input disabled={captureStatus?.running} type="number" value={captureConfig.target_port} onChange={(e) => updateConfig('target_port', Number(e.target.value))} className="mt-1 block h-8 w-24 border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200" /></label>
          </>}
          {captureStatus?.running ? <button disabled={loading} onClick={() => runAction(stopSniffer)} className="flex h-8 items-center gap-1.5 border border-rose-500/50 bg-rose-500/10 px-3 text-[10px] uppercase text-rose-300"><Square className="h-3 w-3" /> Stop</button> : <button disabled={loading || (captureConfig.mode === 'passive_pcap' && !captureConfig.interface_name)} onClick={() => runAction(() => startSniffer(captureConfig))} className="flex h-8 items-center gap-1.5 border border-emerald-500/50 bg-emerald-500/10 px-3 text-[10px] uppercase text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-3 w-3" /> Start</button>}
          <div className="ml-auto flex gap-2">
            <button disabled={loading} onClick={() => runAction(openSnifferCapture)} className="flex h-8 items-center gap-1.5 border border-slate-700 px-2.5 text-[10px] text-slate-300 hover:text-white"><FolderOpen className="h-3.5 w-3.5" /> Open</button>
            <button disabled={loading} onClick={() => runAction(saveSnifferCapture)} className="flex h-8 items-center gap-1.5 border border-slate-700 px-2.5 text-[10px] text-slate-300 hover:text-white"><Download className="h-3.5 w-3.5" /> NXCAP</button>
            <button disabled={loading} onClick={() => runAction(exportSnifferCSV)} className="h-8 border border-slate-700 px-2.5 text-[10px] text-slate-300 hover:text-white">CSV</button>
            <button disabled={loading} onClick={() => setShowReportModal(true)} className="flex h-8 items-center gap-1.5 border border-cyan-800/80 px-2.5 text-[10px] text-cyan-300 hover:bg-cyan-950/40" title="Xuất báo cáo ca trực HTML">
              <FileText className="h-3.5 w-3.5" /> HTML Report
            </button>
          </div>
        </div>
      )}

      <div className="relative grid min-h-0 flex-1 grid-cols-[190px_minmax(400px,1fr)] xl:grid-cols-[210px_minmax(430px,1fr)_330px]">
        <aside className="flex min-h-0 flex-col border-r border-slate-800 bg-[#07101a]/95">
          <div className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Bus health</span>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${stateTone[health?.state || 'unknown']}`}>{stateLabel[health?.state || 'unknown']}</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div
                className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full"
                style={{ background: `conic-gradient(${scoreColour} ${score * 3.6}deg, #172033 0deg)` }}
              >
                <div className="grid h-[58px] w-[58px] place-items-center rounded-full bg-[#07101a]">
                  <div className="text-center"><div className="text-xl font-black font-mono text-white">{score}</div><div className="text-[8px] text-slate-500">/100</div></div>
                </div>
              </div>
              <div className="space-y-1.5 text-[10px] text-slate-500">
                <div>CRC <b className="float-right ml-3 text-slate-300">{health?.crc_error_frames || 0}</b></div>
                <div>Malformed <b className="float-right ml-3 text-slate-300">{health?.malformed_frames || 0}</b></div>
                <div>Orphan <b className="float-right ml-3 text-slate-300">{health?.orphan_responses || 0}</b></div>
                <div>Timeout <b className="float-right ml-3 text-slate-300">{health?.timeouts || 0}</b></div>
                <div>Retry <b className="float-right ml-3 text-slate-300">{health?.retries || 0}</b></div>
                <div>Pending <b className="float-right ml-3 text-slate-300">{health?.pending_requests || 0}</b></div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500"><Cpu className="h-3 w-3" /> Thiết bị</span>
            {selectedUnit != null && <button onClick={() => setSelectedUnit(null)} className="text-[9px] text-cyan-400 hover:text-cyan-200">Bỏ lọc</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {(health?.devices || []).length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] leading-5 text-slate-600">Chưa nhận diện thiết bị.<br />Bắt đầu polling để tạo dữ liệu.</div>
            ) : health?.devices.map((device) => (
              <DeviceRow
                key={device.unit_id}
                device={device}
                baseline={snapshot?.baseline?.devices?.[device.unit_id]}
                selected={selectedUnit === device.unit_id}
                onClick={() => setSelectedUnit(selectedUnit === device.unit_id ? null : device.unit_id)}
              />
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col bg-[#05090f]/95">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-600" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Unit, FC, address hoặc chuỗi hex…" className="h-8 w-full border border-slate-800 bg-slate-950 pl-8 pr-3 text-[11px] text-slate-200 outline-none placeholder:text-slate-700 focus:border-cyan-600/60" />
            </div>
            <button onClick={() => setOnlyIssues(!onlyIssues)} className={`flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-wide ${onlyIssues ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-slate-800 text-slate-500 hover:text-slate-300'}`}>
              <TriangleAlert className="h-3.5 w-3.5" /> Chỉ lỗi
            </button>
            <div className="flex h-8 border border-slate-800 text-[9px] uppercase"><button onClick={() => setViewMode('frames')} className={`px-2 ${viewMode === 'frames' ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-600'}`}>Frames</button><button onClick={() => setViewMode('transactions')} className={`border-l border-slate-800 px-2 ${viewMode === 'transactions' ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-600'}`}>Transactions</button></div>
            <span className="ml-auto font-mono text-[10px] text-slate-600">{displayRows.length} / {snapshot?.frames.length || 0}</span>
          </div>

          <div className="grid h-8 shrink-0 grid-cols-[82px_34px_58px_62px_1fr_82px] items-center border-b border-slate-800 bg-slate-900/60 px-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">
            <span>Time</span><span>Dir</span><span>Unit</span><span>FC</span><span>Decode</span><span className="text-right">Latency</span>
          </div>
          <div ref={frameList.ref} className="min-h-0 flex-1 overflow-y-auto font-mono">
            {frames.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div><Radio className="mx-auto h-8 w-8 text-slate-800" /><p className="mt-3 text-xs text-slate-600">Đang chờ frame Modbus…</p></div>
              </div>
            ) : (
              <div style={{ height: frameList.totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${frameList.offsetTop}px)` }}>
              {frameList.visible.map(({ key, frame, summary }) => {
              const issue = (frame.diagnostics?.length || 0) > 0 || frame.parsed?.kind === 'exception';
              return (
                <button key={key} onClick={() => setSelectedFrameID(frame.id)} style={{ height: FRAME_ROW_HEIGHT }} className={`grid w-full grid-cols-[82px_34px_58px_62px_1fr_82px] items-center overflow-hidden border-b px-3 text-left text-[10px] transition ${selected?.id === frame.id ? 'border-cyan-900 bg-cyan-400/[.08]' : 'border-slate-900 hover:bg-slate-900/70'}`}>
                  <span className="text-slate-500">{frame.timestamp}</span>
                  <span>{frame.direction === 'master_to_slave' ? <ArrowUpRight className="h-3.5 w-3.5 text-sky-400" /> : frame.direction === 'slave_to_master' ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" /> : <span className="text-slate-600">?</span>}</span>
                  <span className="font-bold text-slate-300">{frame.parsed ? String(frame.parsed.unit_id).padStart(3, '0') : '—'}</span>
                  <span className={issue ? 'text-rose-300' : 'text-cyan-300'}>{frame.parsed ? `0x${frame.parsed.function_code.toString(16).padStart(2, '0').toUpperCase()}` : '—'}</span>
                  <span className="min-w-0 truncate pr-4 text-slate-400"><b className="mr-2 text-slate-600">{frame.transport.toUpperCase()}</b>{summary}</span>
                  <span className="text-right text-slate-500">{formatLatency(frame.response_time_us)}</span>
                </button>
              );
            })}
              </div>
              </div>
            )}
          </div>
        </main>

        <FrameInspector selected={selected} />
      </div>

      <footer className="relative flex h-7 shrink-0 items-center justify-between border-t border-slate-800 bg-[#060c13] px-4 font-mono text-[9px] uppercase tracking-wider text-slate-600">
        <span>{captureStatus?.running
          ? captureStatus.tcp
            ? `${captureStatus.mode} · ${captureStatus.tcp.packets} packets · ${captureStatus.tcp.flows} flow(s) · retrans ${captureStatus.tcp.retransmissions} · out-of-order ${captureStatus.tcp.out_of_order} · gaps ${captureStatus.tcp.gaps} · RST ${captureStatus.tcp.resets}${captureStatus.dropped_frames ? ` · dropped ${captureStatus.dropped_frames}` : ''}`
            : `${captureStatus.mode} · ${captureStatus.listen_address || ''} · ${captureStatus.active_connections} connection(s) · ${captureStatus.bytes_captured} bytes${captureStatus.dropped_frames ? ` · dropped ${captureStatus.dropped_frames}` : ''}`
          : 'Internal capture · reconstructed frames are labelled'}</span>
        <span className={error || captureError ? 'text-rose-400' : 'text-emerald-500'}>{error || captureError || 'Analyzer pipeline online'}</span>
      </footer>

      {/* Toast Notification */}
      {reportSuccess && (
        <div className="fixed bottom-12 right-6 z-[100] flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-950/90 px-4 py-2.5 text-xs font-semibold text-emerald-200 shadow-2xl backdrop-blur">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{reportSuccess}</span>
        </div>
      )}

      {/* Capture Diff Analyzer Modal */}
      <CaptureDiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        diffPathA={diffPathA}
        diffPathB={diffPathB}
        onSelectDiffFileA={handleSelectDiffFileA}
        onSelectDiffFileB={handleSelectDiffFileB}
        onRunDiff={handleRunDiff}
        diffLoading={diffLoading}
        diffResult={diffResult}
        formatLatency={formatLatency}
      />

      {/* Shift Report Generator Modal */}
      <ShiftReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportOpts={reportOpts}
        onChangeReportOpts={setReportOpts}
        onExportReport={handleExportReport}
      />
    </div>
  );
};
