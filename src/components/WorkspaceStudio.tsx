import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, ChevronRight, CircleDot, Download, FileUp,
  Grid3X3, HelpCircle, LineChart, Menu, MonitorSmartphone, Network, PanelLeftClose,
  Pause, Play, Plus, Radio, Save, ScanSearch, Server, Settings2, Shield, Square,
  Stethoscope, Terminal, Trash2, Unplug, Waves, X, Zap,
} from 'lucide-react';
import {
  ConnectionConfig, DataFormat, RegisterRow, SessionRole, SlaveTable, TabSession, TrafficEntry,
} from '../types/modbus';

interface RuntimeSummary {
  isConnected: boolean;
  isPolling: boolean;
  isListening: boolean;
  connectionConfig: ConnectionConfig | null;
  txCount: number;
  errCount: number;
  latencyMs: number;
  traffic: TrafficEntry[];
  slaveActivityCount: number;
}

export interface StudioGridHandlers {
  onRowDoubleClick: (row: RegisterRow) => void;
  onUpdateAlias: (address: number, alias: string) => void;
  onUpdateUnit: (address: number, unit: string) => void;
  onUpdateScaling: (address: number, scaling: number) => void;
  onUpdateFormat?: (address: number, format: DataFormat) => void;
  onInlineWrite: (address: number, value: string) => void;
  onToggleCoil: (address: number, value: boolean) => void;
  onOpenChart?: (row: RegisterRow) => void;
}

interface GridPane {
  tab: TabSession;
  rows: RegisterRow[];
  isCoil: boolean;
  handlers: StudioGridHandlers;
  chartColors?: Record<number, string>;
}

interface WorkspaceStudioProps {
  tabs: TabSession[];
  activeTab: TabSession;
  activeTabId: string;
  runtime: RuntimeSummary;
  primary: GridPane;
  secondary?: GridPane;
  splitView: boolean;
  showTraffic: boolean;
  chart?: React.ReactNode;
  onUseClassic: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, event: React.MouseEvent) => void;
  onAddTab: () => void;
  onRenameTab: (id: string, title: string) => void;
  onRoleChange: (role: SessionRole) => void;
  onFormatChange: (format: DataFormat) => void;
  onTableChange: (table: SlaveTable) => void;
  onSecondaryTabChange: (tabID: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onDefinition: () => void;
  onTogglePoll: () => void;
  onReadOnce: () => void;
  onClearCounters: () => void;
  onSlaveSetup: () => void;
  onToggleSlave: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExportCSV: () => void;
  onOpenScanner: () => void;
  onOpenMobile: () => void;
  onOpenAnalyzerStudio: () => void;
  onOpenDiagnostics: () => void;
  onOpenHelp: () => void;
  onToggleTraffic: () => void;
  onClearTraffic: () => void;
  onToggleSplit: () => void;
  onToggleChart: () => void;
}

const formatOptions: Array<[DataFormat, string]> = [
  ['unsigned16', 'UInt16'], ['signed16', 'Int16'], ['hex16', 'Hex'], ['bin16', 'Binary'],
  ['float_abcd', 'Float ABCD'], ['float_cdab', 'Float CDAB'], ['float_badc', 'Float BADC'],
  ['float_dcba', 'Float DCBA'], ['long_abcd', 'Int32 ABCD'], ['long_cdab', 'Int32 CDAB'],
  ['uint32_abcd', 'UInt32 ABCD'], ['uint32_cdab', 'UInt32 CDAB'], ['ascii', 'ASCII'],
  ['int64', 'Int64'], ['uint64', 'UInt64'], ['water_48_be', 'Water 48 BE'],
  ['water_48_le', 'Water 48 LE'], ['water_48_bcd', 'Water 48 BCD'],
];

const connectionLabel = (runtime: RuntimeSummary, tab: TabSession) => {
  if (tab.role === 'slave') return runtime.isListening ? 'Đang lắng nghe' : 'Slave đang dừng';
  if (!runtime.isConnected || !runtime.connectionConfig) return 'Chưa kết nối';
  const cfg = runtime.connectionConfig;
  return cfg.type === 'serial' ? `${cfg.port} · ${cfg.baud_rate}` : `${cfg.host}:${cfg.port}`;
};

export const WorkspaceStudio: React.FC<WorkspaceStudioProps> = (props) => {
  const { activeTab, runtime } = props;
  const [railOpen, setRailOpen] = useState(true);

  const tools = [
    { label: 'Scanner', icon: ScanSearch, action: props.onOpenScanner },
    { label: 'Bus Analyzer', icon: Network, action: props.onOpenAnalyzerStudio },
    { label: 'Tự kiểm tra', icon: Stethoscope, action: props.onOpenDiagnostics },
    { label: 'Mobile', icon: MonitorSmartphone, action: props.onOpenMobile },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#07100e] text-slate-100">
      <aside className={`${railOpen ? 'w-[208px]' : 'w-[66px]'} flex shrink-0 flex-col border-r border-white/[.08] bg-[#091410] transition-[width] duration-200`}>
        <div className="flex h-16 items-center gap-3 border-b border-white/[.08] px-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-300 text-[#07100e]"><Waves className="h-5 w-5" /></div>
          {railOpen && <div className="min-w-0"><div className="truncate text-sm font-black tracking-tight">NXChieu Studio</div><div className="text-[9px] uppercase tracking-[.18em] text-emerald-300/70">Industrial Modbus</div></div>}
        </div>

        <nav className="space-y-1 p-3">
          <RailButton open={railOpen} active icon={Grid3X3} label="Workspace" />
          {tools.map((item) => <RailButton key={item.label} open={railOpen} icon={item.icon} label={item.label} onClick={item.action} />)}
        </nav>

        <div className="mx-3 border-t border-white/[.08] pt-3">
          <RailButton open={railOpen} icon={FileUp} label="Mở dự án" onClick={props.onOpenProject} />
          <RailButton open={railOpen} icon={Save} label="Lưu dự án" onClick={props.onSaveProject} />
          <RailButton open={railOpen} icon={Download} label="Xuất CSV" onClick={props.onExportCSV} />
        </div>

        <div className="mt-auto space-y-1 border-t border-white/[.08] p-3">
          <RailButton open={railOpen} icon={HelpCircle} label="Hướng dẫn" onClick={props.onOpenHelp} />
          <RailButton open={railOpen} icon={PanelLeftClose} label="Giao diện cũ" onClick={props.onUseClassic} />
          <button onClick={() => setRailOpen(!railOpen)} className="mt-2 flex h-9 w-full items-center justify-center rounded-xl text-slate-600 hover:bg-white/[.04] hover:text-slate-300"><Menu className="h-4 w-4" /></button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-white/[.08] bg-[#08120f] px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h1 className="truncate text-base font-bold tracking-tight">{activeTab.title}</h1><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${activeTab.role === 'master' ? 'border-cyan-300/25 bg-cyan-300/[.07] text-cyan-200' : 'border-amber-300/25 bg-amber-300/[.07] text-amber-200'}`}>{activeTab.role}</span></div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${runtime.isConnected || runtime.isListening ? 'bg-emerald-300' : 'bg-slate-600'}`} />{connectionLabel(runtime, activeTab)}</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="mr-1 flex rounded-xl border border-white/10 bg-black/10 p-0.5">
              <button onClick={() => props.onRoleChange('master')} className={`rounded-lg px-2.5 py-1.5 text-[9px] font-bold ${activeTab.role === 'master' ? 'bg-cyan-300 text-[#07100e]' : 'text-slate-600'}`}>MASTER</button>
              <button onClick={() => props.onRoleChange('slave')} className={`rounded-lg px-2.5 py-1.5 text-[9px] font-bold ${activeTab.role === 'slave' ? 'bg-amber-300 text-[#07100e]' : 'text-slate-600'}`}>SLAVE</button>
            </div>
            <div className="mr-2 hidden items-center gap-4 xl:flex"><HeaderMetric label="TX" value={runtime.txCount} /><HeaderMetric label="Lỗi" value={runtime.errCount} danger={runtime.errCount > 0} /><HeaderMetric label="Độ trễ" value={`${runtime.latencyMs || 0} ms`} /></div>
            {activeTab.role === 'master' ? <>
              {runtime.isConnected ? <ActionButton tone="danger" icon={Unplug} label="Ngắt kết nối" onClick={props.onDisconnect} /> : <ActionButton tone="primary" icon={Zap} label="Kết nối" onClick={props.onConnect} />}
              <ActionButton icon={Settings2} label="Định nghĩa" onClick={props.onDefinition} />
              <ActionButton disabled={!runtime.isConnected} tone={runtime.isPolling ? 'warning' : 'success'} icon={runtime.isPolling ? Pause : Play} label={runtime.isPolling ? 'Tạm dừng' : 'Polling'} onClick={props.onTogglePoll} />
              <button disabled={!runtime.isConnected || runtime.isPolling} onClick={props.onReadOnce} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-30" title="Đọc một lần"><Radio className="h-4 w-4" /></button>
            </> : <>
              <ActionButton tone={runtime.isListening ? 'danger' : 'success'} icon={runtime.isListening ? Square : Play} label={runtime.isListening ? 'Dừng server' : 'Chạy server'} onClick={props.onToggleSlave} />
              <ActionButton icon={Server} label="Cấu hình Slave" onClick={props.onSlaveSetup} />
            </>}
          </div>
        </header>

        <div className="flex h-12 shrink-0 items-end border-b border-white/[.08] bg-[#091410] px-4">
          <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
            {props.tabs.map((tab) => <SessionTab key={tab.id} tab={tab} active={tab.id === props.activeTabId} onSelect={() => props.onSelectTab(tab.id)} onClose={(event) => props.onCloseTab(tab.id, event)} onRename={props.onRenameTab} />)}
            <button onClick={props.onAddTab} className="mb-1.5 ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-emerald-200"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mb-1.5 flex items-center gap-1">
            {activeTab.role === 'slave' && <select value={activeTab.slaveTable} onChange={(event) => props.onTableChange(event.target.value as SlaveTable)} className="h-8 rounded-lg border border-amber-300/20 bg-[#07100e] px-2 text-[10px] text-amber-200 outline-none"><option value="holding">4x Holding</option><option value="input">3x Input</option><option value="coils">0x Coils</option><option value="discrete">1x Discrete</option></select>}
            {props.splitView && props.secondary && <select value={props.secondary.tab.id} onChange={(event) => props.onSecondaryTabChange(event.target.value)} className="h-8 max-w-32 rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] text-slate-300 outline-none">{props.tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.title}</option>)}</select>}
            <select value={activeTab.format} onChange={(event) => props.onFormatChange(event.target.value as DataFormat)} className="h-8 rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] text-slate-300 outline-none">{formatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <IconButton active={props.splitView} icon={PanelLeftClose} title="Chia đôi workspace" onClick={props.onToggleSplit} />
            <IconButton icon={LineChart} title="Biểu đồ" onClick={props.onToggleChart} />
            <IconButton active={props.showTraffic} icon={Terminal} title="Traffic" onClick={props.onToggleTraffic} />
          </div>
        </div>

        <div className={`grid min-h-0 flex-1 ${props.splitView && props.secondary ? 'grid-cols-2 divide-x divide-white/[.08]' : 'grid-cols-1'}`}>
          {/* key: a grid's selection and typed value must never carry over to another tab. */}
          <StudioRegisterGrid key={props.primary.tab.id} pane={props.primary} />
          {props.splitView && props.secondary && <StudioRegisterGrid key={props.secondary.tab.id} pane={props.secondary} />}
        </div>

        {props.chart}
        {props.showTraffic && <StudioTraffic entries={runtime.traffic} onClear={props.onClearTraffic} onAnalyzer={props.onOpenAnalyzerStudio} />}

        <footer className="flex h-8 shrink-0 items-center border-t border-white/[.08] bg-[#08120f] px-4 text-[9px] text-slate-600">
          <span>{activeTab.role === 'master' ? `Unit ${activeTab.definition.slave_id} · FC${String(activeTab.definition.function_code).padStart(2, '0')} · ${activeTab.definition.quantity} điểm` : `Unit ${activeTab.slaveConfig?.slave_id || 1} · ${activeTab.slaveTable.toUpperCase()} · ${activeTab.slaveQuantity} điểm`}</span>
          <button onClick={props.onClearCounters} className="ml-3 text-slate-700 hover:text-slate-300">Reset counters</button>
          <span className="ml-auto flex items-center gap-1.5 text-emerald-300/70"><CircleDot className="h-3 w-3" /> Backend dùng chung với giao diện cũ</span>
        </footer>
      </div>
    </div>
  );
};

const RailButton = ({ open, icon: Icon, label, active, onClick }: { open: boolean; icon: React.ElementType; label: string; active?: boolean; onClick?: () => void }) => <button onClick={onClick} title={!open ? label : undefined} className={`mb-1 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[11px] font-medium transition ${active ? 'bg-emerald-300 text-[#07100e]' : 'text-slate-500 hover:bg-white/[.045] hover:text-slate-200'}`}><Icon className="h-4 w-4 shrink-0" />{open && <span>{label}</span>}</button>;
const HeaderMetric = ({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) => <div><div className="text-[8px] uppercase tracking-[.16em] text-slate-600">{label}</div><div className={`mt-0.5 font-mono text-xs font-bold ${danger ? 'text-rose-300' : 'text-slate-300'}`}>{value}</div></div>;
const ActionButton = ({ icon: Icon, label, onClick, tone = 'neutral', disabled }: { icon: React.ElementType; label: string; onClick: () => void; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'; disabled?: boolean }) => { const tones = { neutral: 'border-white/10 text-slate-300 hover:bg-white/5', primary: 'border-emerald-300/30 bg-emerald-300 text-[#07100e]', success: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200', warning: 'border-amber-300/30 bg-amber-300/10 text-amber-200', danger: 'border-rose-300/30 bg-rose-300/10 text-rose-200' }; return <button disabled={disabled} onClick={onClick} className={`flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone]}`}><Icon className="h-3.5 w-3.5" />{label}</button>; };
const IconButton = ({ icon: Icon, title, onClick, active }: { icon: React.ElementType; title: string; onClick: () => void; active?: boolean }) => <button onClick={onClick} title={title} className={`grid h-8 w-8 place-items-center rounded-lg border ${active ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-white/10 text-slate-500 hover:text-slate-200'}`}><Icon className="h-3.5 w-3.5" /></button>;

const SessionTab = ({ tab, active, onSelect, onClose, onRename }: { tab: TabSession; active: boolean; onSelect: () => void; onClose: (e: React.MouseEvent) => void; onRename: (id: string, title: string) => void }) => {
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(tab.title);
  const commit = () => { const next = title.trim(); if (next) onRename(tab.id, next); setEditing(false); };
  return <div onClick={onSelect} onDoubleClick={() => setEditing(true)} className={`group mb-0 flex h-10 min-w-[132px] max-w-[220px] cursor-pointer items-center gap-2 rounded-t-xl border-x border-t px-3 ${active ? 'border-white/10 bg-[#07100e] text-slate-100' : 'border-transparent text-slate-600 hover:text-slate-300'}`}>{tab.role === 'master' ? <Radio className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> : <Shield className="h-3.5 w-3.5 shrink-0 text-amber-300" />}{editing ? <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="min-w-0 flex-1 bg-transparent text-[10px] outline-none" /> : <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{tab.title}</span>}<button onClick={onClose} className="opacity-0 transition group-hover:opacity-100"><X className="h-3 w-3" /></button></div>;
};

const StudioRegisterGrid = ({ pane }: { pane: GridPane }) => {
  const [query, setQuery] = useState(''); const [selectedAddress, setSelectedAddress] = useState<number | null>(null); const [writeValue, setWriteValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const selected = pane.rows.find((row) => row.address === selectedAddress) || pane.rows[0];
  // Quick write only targets a row the user explicitly selected, never the first row by default,
  // and is unavailable on read-only tables (FC02/FC04 on a master).
  const writeTarget = selectedAddress !== null ? pane.rows.find((row) => row.address === selectedAddress) : undefined;
  const readOnlyTable = pane.tab.role === 'master' && (pane.tab.definition.function_code === 2 || pane.tab.definition.function_code === 4);
  const canWrite = Boolean(writeTarget) && !readOnlyTable;
  const commitWrite = () => {
    if (!canWrite || !writeTarget || !writeValue.trim()) return;
    pane.handlers.onInlineWrite(writeTarget.address, writeValue);
    setWriteValue('');
  };
  const rows = useMemo(() => { const q = query.trim().toLowerCase(); return !q ? pane.rows : pane.rows.filter((row) => `${row.address} ${row.displayAddress} ${row.alias} ${row.displayValue}`.toLowerCase().includes(q)); }, [pane.rows, query]);
  const rowHeight = 48;
  const overscan = 8;
  const startIndex = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewport.height / rowHeight) + overscan * 2;
  const visibleRows = rows.slice(startIndex, startIndex + visibleCount);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport((current) => ({ ...current, height: element.clientHeight || 600 }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className="flex min-h-0 min-w-0 bg-[#07100e]">
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-white/[.07] px-4"><div className="min-w-0"><div className="truncate text-[11px] font-bold">{pane.tab.title}</div><div className="text-[9px] text-slate-600">{pane.rows.length} điểm dữ liệu · {pane.isCoil ? 'Bit table' : 'Register table'}</div></div><div className="relative ml-auto w-56"><Grid3X3 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-600" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm địa chỉ hoặc tên biến" className="h-8 w-full rounded-lg border border-white/10 bg-white/[.025] pl-8 pr-2 text-[10px] outline-none focus:border-emerald-300/30" /></div></div>
      <div className="grid h-9 shrink-0 grid-cols-[54px_105px_minmax(150px,1fr)_130px_92px_74px_38px] items-center border-b border-white/[.07] px-3 text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600"><span>#</span><span>Địa chỉ</span><span>Tên biến</span><span>Giá trị</span><span>Raw</span><span>Cập nhật</span><span /></div>
      <div ref={scrollRef} onScroll={(event) => setViewport((current) => ({ ...current, top: event.currentTarget.scrollTop }))} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
            {visibleRows.map((row, offset) => { const index = startIndex + offset; return <button key={row.address} onClick={() => setSelectedAddress(row.address)} onDoubleClick={() => pane.handlers.onRowDoubleClick(row)} className={`grid h-12 w-full grid-cols-[54px_105px_minmax(150px,1fr)_130px_92px_74px_38px] items-center border-b px-3 text-left ${selected?.address === row.address ? 'border-emerald-300/15 bg-emerald-300/[.055]' : 'border-white/[.045] hover:bg-white/[.025]'}`}><span className="font-mono text-[9px] text-slate-700">{String(index + 1).padStart(2, '0')}</span><span className="font-mono text-[10px] text-slate-400">{row.displayAddress}</span><span className="truncate pr-3 text-[11px] font-medium text-slate-300">{row.alias || <span className="italic text-slate-700">Chưa đặt tên</span>}</span><span className={`font-mono text-sm font-bold ${row.changed ? 'text-amber-200' : row.hasValue ? 'text-emerald-200' : 'text-slate-600'}`}>{row.displayValue}<small className="ml-1 text-[9px] font-normal text-slate-600">{row.unit}</small></span><span className="font-mono text-[9px] text-slate-600">{row.rawHex}</span><span className="text-[9px] text-slate-700">{row.lastUpdated || '—'}</span><span>{pane.chartColors?.[row.address] ? <BarChart3 className="h-3.5 w-3.5" style={{ color: pane.chartColors[row.address] }} /> : <ChevronRight className="h-3.5 w-3.5 text-slate-700" />}</span></button>; })}
          </div>
        </div>
      </div>
    </div>
    <aside className="hidden w-[255px] shrink-0 overflow-y-auto border-l border-white/[.07] bg-[#091410] min-[1180px]:block">
      <div className="border-b border-white/[.07] p-4"><div className="text-[8px] font-semibold uppercase tracking-[.18em] text-slate-600">Point inspector</div><div className="mt-2 font-mono text-lg font-black text-emerald-200">{selected?.displayValue || '—'} <span className="text-xs font-normal text-slate-600">{selected?.unit}</span></div><div className="mt-1 text-[10px] text-slate-500">{selected?.displayAddress || 'Chọn một hàng'}</div></div>
      {selected && <div key={selected.address} className="space-y-3 p-4"><StudioField label="Tên biến" value={selected.alias} onBlur={(value) => pane.handlers.onUpdateAlias(selected.address, value)} /><StudioField label="Đơn vị" value={selected.unit} onBlur={(value) => pane.handlers.onUpdateUnit(selected.address, value)} /><StudioField label="Scale" value={String(selected.scaling)} onBlur={(value) => pane.handlers.onUpdateScaling(selected.address, Number(value) || 1)} />
        <label className="block"><span className="text-[9px] uppercase tracking-wider text-slate-600">Định dạng</span><select value={selected.format || pane.tab.format} onChange={(e) => pane.handlers.onUpdateFormat?.(selected.address, e.target.value as DataFormat)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] outline-none">{formatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="border-t border-white/[.07] pt-3"><span className="text-[9px] uppercase tracking-wider text-slate-600">Ghi nhanh</span>{pane.isCoil ? <button disabled={!canWrite} onClick={() => { if (canWrite && writeTarget) pane.handlers.onToggleCoil(writeTarget.address, Boolean(writeTarget.rawValue)); }} className="mt-1 h-9 w-full rounded-lg bg-emerald-300 text-[10px] font-bold text-[#07100e] disabled:opacity-40">{readOnlyTable ? 'Bảng chỉ đọc' : !writeTarget ? 'Chọn một dòng để ghi' : `Chuyển ${writeTarget.rawValue ? 'OFF' : 'ON'}`}</button> : <div className="mt-1 flex gap-1"><input value={writeValue} disabled={!canWrite} onChange={(e) => setWriteValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitWrite(); }} placeholder={readOnlyTable ? 'Bảng chỉ đọc' : !writeTarget ? 'Chọn một dòng để ghi' : 'Giá trị mới'} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] outline-none" /><button disabled={!canWrite} onClick={commitWrite} className="h-9 rounded-lg bg-emerald-300 px-3 text-[10px] font-bold text-[#07100e] disabled:opacity-40">Ghi</button></div>}</div>
        <button onClick={() => pane.handlers.onOpenChart?.(selected)} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] text-slate-300 hover:bg-white/5"><LineChart className="h-3.5 w-3.5" /> Theo dõi biểu đồ</button>
      </div>}
    </aside>
  </div>;
};

const StudioField = ({ label, value, onBlur }: { label: string; value: string; onBlur: (value: string) => void }) => { const [draft, setDraft] = useState(value); return <label className="block"><span className="text-[9px] uppercase tracking-wider text-slate-600">{label}</span><input value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => setDraft(value)} onBlur={() => onBlur(draft)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#07100e] px-2 text-[10px] outline-none focus:border-emerald-300/30" /></label>; };

const StudioTraffic = ({ entries, onClear, onAnalyzer }: { entries: TrafficEntry[]; onClear: () => void; onAnalyzer: () => void }) => <div className="flex h-36 shrink-0 flex-col border-t border-white/[.08] bg-[#050b09]"><div className="flex h-9 items-center border-b border-white/[.06] px-4"><Terminal className="mr-2 h-3.5 w-3.5 text-emerald-300" /><span className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-500">Traffic stream</span><span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[8px] text-slate-600">{entries.length}</span><button onClick={onAnalyzer} className="ml-auto text-[9px] text-emerald-300/70 hover:text-emerald-200">Mở Analyzer</button><button onClick={onClear} className="ml-3 text-slate-600 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button></div><div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[9px] leading-5">{entries.length === 0 ? <div className="grid h-full place-items-center text-slate-700">Đang chờ dữ liệu Modbus...</div> : entries.slice(-100).map((entry, index) => <div key={`${entry.timestamp}-${index}`} className="flex gap-3"><span className="text-slate-700">{entry.timestamp}</span><span className={entry.direction === 'tx' ? 'text-cyan-300' : entry.direction === 'rx' ? 'text-emerald-300' : 'text-rose-300'}>{entry.direction.toUpperCase()}</span><span className="break-all text-slate-500">{entry.hex}</span></div>)}</div></div>;
