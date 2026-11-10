import React, { useState, useEffect } from 'react';
import {
  Database,
  Play,
  Square,
  Download,
  Trash2,
  Clock,
  Calendar,
  X,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import {
  datalogStartSession,
  datalogStopSession,
  datalogLogBatch,
  datalogListSessions,
  datalogGetRecords,
  datalogExportCSV,
  datalogDeleteSession,
} from '../services/backend';
import { RegisterRow, TabSession } from '../types/modbus';

interface DataloggerStudioProps {
  activeRows: RegisterRow[];
  activeTab: TabSession;
  onClose: () => void;
}

export const DataloggerStudio: React.FC<DataloggerStudioProps> = ({
  activeRows,
  activeTab: _activeTab,
  onClose,
}) => {
  const [isLogging, setIsLogging] = useState<boolean>(false);
  const [sessionName, setSessionName] = useState<string>('Test Ngâm Thiết Bị 24h');
  const [intervalSec, setIntervalSec] = useState<number>(2);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [selectedAddresses, setSelectedAddresses] = useState<number[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [inspectSession, setInspectSession] = useState<any | null>(null);
  const [inspectRecords, setInspectRecords] = useState<any[]>([]);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [sampleCounter, setSampleCounter] = useState<number>(0);

  // Auto select first 5 addresses initially
  useEffect(() => {
    if (activeRows.length > 0 && selectedAddresses.length === 0) {
      setSelectedAddresses(activeRows.slice(0, 6).map((r) => r.address));
    }
  }, [activeRows]);

  const refreshSessions = async () => {
    try {
      const list = await datalogListSessions();
      setSessions(list || []);
      const active = (list || []).find((s) => s.is_active);
      if (active) {
        setIsLogging(true);
        setActiveSessionId(active.id);
        setSessionName(active.name);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  // Timer loop for active logging
  useEffect(() => {
    let timer: any = null;
    let sampleTimer: any = null;

    if (isLogging && activeSessionId) {
      timer = setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);

      sampleTimer = setInterval(async () => {
        // Collect current values from activeRows matching selectedAddresses
        const recordsToLog = activeRows
          .filter((r) => selectedAddresses.includes(r.address))
          .map((r) => {
            let numericVal = 0;
            if (typeof r.rawValue === 'number') numericVal = r.rawValue;
            else if (typeof r.rawValue === 'boolean') numericVal = r.rawValue ? 1 : 0;
            else {
              const p = parseFloat(String(r.displayValue).replace(/,/g, ''));
              numericVal = isNaN(p) ? 0 : p;
            }

            return {
              timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
              address: r.address,
              display_address: r.displayAddress,
              alias: r.alias || `Reg ${r.displayAddress}`,
              value: numericVal,
              unit: r.unit || '',
              raw_hex: r.rawHex || '',
            };
          });

        if (recordsToLog.length > 0) {
          try {
            await datalogLogBatch(activeSessionId, recordsToLog);
            setSampleCounter((prev) => prev + recordsToLog.length);
          } catch (e) {
            console.error('datalogLogBatch error:', e);
          }
        }
      }, intervalSec * 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (sampleTimer) clearInterval(sampleTimer);
    };
  }, [isLogging, activeSessionId, activeRows, selectedAddresses, intervalSec]);

  const handleStartLogging = async () => {
    if (selectedAddresses.length === 0) {
      alert('Vui lòng chọn ít nhất một kênh đo cần ghi nhật ký!');
      return;
    }
    try {
      const sessID = await datalogStartSession(sessionName, intervalSec, selectedAddresses.length);
      setActiveSessionId(sessID);
      setIsLogging(true);
      setElapsedSec(0);
      setSampleCounter(0);
      await refreshSessions();
    } catch (err: any) {
      alert(`Khởi động phiên ghi thất bại: ${err}`);
    }
  };

  const handleStopLogging = async () => {
    try {
      await datalogStopSession(activeSessionId);
      setIsLogging(false);
      setActiveSessionId('');
      await refreshSessions();
    } catch (err: any) {
      alert(`Dừng phiên ghi thất bại: ${err}`);
    }
  };

  const handleInspect = async (s: any) => {
    setInspectSession(s);
    try {
      const recs = await datalogGetRecords(s.id, 200, 0);
      setInspectRecords(recs || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExport = async (sessID: string, sName: string) => {
    const filename = `Datalog_${sName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.csv`;
    try {
      const count = await datalogExportCSV(sessID, filename);
      alert(`Đã xuất thành công ${count} bản ghi ra file: ${filename}`);
    } catch (err: any) {
      alert(`Lỗi xuất file CSV: ${err}`);
    }
  };

  const handleDelete = async (sessID: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu phiên này khỏi SQLite?')) return;
    try {
      await datalogDeleteSession(sessID);
      if (inspectSession?.id === sessID) {
        setInspectSession(null);
        setInspectRecords([]);
      }
      await refreshSessions();
    } catch (err: any) {
      alert(`Lỗi xóa phiên: ${err}`);
    }
  };

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-950 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white text-sm">Overnight Datalogger Engine</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-purple-950 text-purple-300 border border-purple-700/50">
                SQLite WAL High-Concurrency
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Ghi nhật ký dài hạn liên tục qua đêm vào cơ sở dữ liệu SQLite cục bộ (hỗ trợ hàng triệu bản ghi, không đầy RAM, xuất CSV chuẩn Excel).
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Đóng Datalogger"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. LOGGING CONTROLLER BAR */}
      <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Session Name */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2">
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px] text-slate-400 font-medium">Tên Phiên:</span>
            <input
              type="text"
              disabled={isLogging}
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="w-48 bg-transparent text-white font-medium text-xs outline-none"
              placeholder="Test Ngâm 24h"
            />
          </div>

          {/* Interval Select */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2 font-mono">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-slate-400 font-sans font-medium">Chu Kỳ Ghi:</span>
            <select
              disabled={isLogging}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className="bg-transparent text-cyan-300 font-bold text-xs outline-none cursor-pointer"
            >
              <option value={1} className="bg-slate-900 text-white">1 giây</option>
              <option value={2} className="bg-slate-900 text-white">2 giây</option>
              <option value={5} className="bg-slate-900 text-white">5 giây</option>
              <option value={10} className="bg-slate-900 text-white">10 giây</option>
              <option value={30} className="bg-slate-900 text-white">30 giây</option>
              <option value={60} className="bg-slate-900 text-white">1 phút</option>
            </select>
          </div>

          {/* Points Selected Badge */}
          <span className="text-[11px] text-slate-400 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
            Kênh theo dõi: <strong className="text-purple-300">{selectedAddresses.length} điểm</strong>
          </span>
        </div>

        {/* Start / Stop Button */}
        <button
          onClick={isLogging ? handleStopLogging : handleStartLogging}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs transition shadow-lg ${
            isLogging
              ? 'bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30'
              : 'bg-purple-400 text-slate-950 hover:bg-purple-300'
          }`}
        >
          {isLogging ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{isLogging ? 'Dừng Ghi Nhật Ký' : 'Bắt Đầu Ghi Nhật Ký'}</span>
        </button>
      </div>

      {/* 3. METRICS STATUS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5 bg-slate-950 border-b border-slate-800">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Trạng Thái Datalogger</span>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2.5 h-2.5 rounded-full ${isLogging ? 'bg-purple-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className={`font-mono font-bold text-sm ${isLogging ? 'text-purple-300' : 'text-slate-500'}`}>
              {isLogging ? 'RECORDING (ĐANG GHI)' : 'IDLE (SẴN SÀNG)'}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Thời Gian Đã Chạy</span>
          <span className="font-mono font-bold text-lg text-cyan-300 mt-1">{formatTime(elapsedSec)}</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Mẫu Đã Lưu (SQLite)</span>
          <span className="font-mono font-bold text-lg text-emerald-400 mt-1">{sampleCounter} records</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase">Tổng Số Phiên Lưu</span>
          <span className="font-mono font-bold text-lg text-purple-300 mt-1">{sessions.length} sessions</span>
        </div>
      </div>

      {/* 4. MAIN WORKSPACE: CHANNEL SELECTOR & PAST SESSIONS */}
      <div className="flex-1 flex overflow-hidden p-5 gap-5">
        {/* Left: Channel Selector */}
        <div className="w-80 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl p-4 overflow-hidden shrink-0">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="font-bold text-white text-xs uppercase tracking-wider">Chọn Kênh Đo Để Ghi</span>
            <button
              disabled={isLogging}
              onClick={() => {
                if (selectedAddresses.length === activeRows.length) setSelectedAddresses([]);
                else setSelectedAddresses(activeRows.map((r) => r.address));
              }}
              className="text-[11px] text-cyan-400 hover:text-cyan-200 transition font-medium"
            >
              {selectedAddresses.length === activeRows.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 mt-3 pr-1">
            {activeRows.length === 0 ? (
              <p className="text-slate-500 text-xs text-center py-6">Chưa có thanh ghi nào trong tab hiện tại.</p>
            ) : (
              activeRows.map((row) => {
                const checked = selectedAddresses.includes(row.address);
                return (
                  <label
                    key={row.address}
                    className={`flex items-center justify-between p-2 rounded-xl border transition cursor-pointer text-xs ${
                      checked
                        ? 'bg-purple-950/40 border-purple-500/40 text-slate-200'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <input
                        type="checkbox"
                        disabled={isLogging}
                        checked={checked}
                        onChange={() => {
                          if (checked) setSelectedAddresses(selectedAddresses.filter((a) => a !== row.address));
                          else setSelectedAddresses([...selectedAddresses, row.address]);
                        }}
                        className="rounded bg-slate-900 border-slate-700 text-purple-500"
                      />
                      <span className="font-mono text-cyan-400 font-bold">{row.displayAddress}</span>
                      <span className="truncate">{row.alias || `Reg ${row.displayAddress}`}</span>
                    </div>
                    <span className="font-mono text-amber-300 font-bold shrink-0">{row.displayValue}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Past Sessions & Data Inspector */}
        <div className="flex-1 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl p-4 overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span className="font-bold text-white text-xs uppercase tracking-wider">
                Lịch Sử Các Phiên Ghi Nhật Ký ({sessions.length})
              </span>
            </div>
            <button
              onClick={refreshSessions}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              title="Làm mới danh sách"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 flex gap-4 overflow-hidden mt-3">
            {/* Sessions Table */}
            <div className="w-1/2 overflow-y-auto space-y-2 pr-1">
              {sessions.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Chưa có phiên ghi nhật ký nào trong SQLite database.
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => handleInspect(s)}
                    className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                      inspectSession?.id === s.id
                        ? 'bg-purple-950/30 border-purple-500/60 ring-1 ring-purple-500/40'
                        : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{s.name}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                          s.is_active
                            ? 'bg-purple-950 text-purple-300 border border-purple-600 animate-pulse'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {s.is_active ? 'ACTIVE' : 'COMPLETED'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>{s.created_at.slice(0, 19).replace('T', ' ')}</span>
                      <span className="text-emerald-400 font-bold">{s.sample_count} mẫu</span>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-900">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(s.id, s.name);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-cyan-900 text-cyan-300 text-[10px] font-bold transition"
                        title="Xuất file CSV"
                      >
                        <Download className="w-3 h-3" />
                        <span>Xuất CSV</span>
                      </button>

                      <button
                        disabled={s.is_active}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.id);
                        }}
                        className="p-1 rounded hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition disabled:opacity-20"
                        title="Xóa phiên này"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Records Inspector */}
            <div className="w-1/2 flex flex-col bg-slate-950/90 border border-slate-800/80 rounded-xl p-3 overflow-hidden font-mono text-[11px]">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[10px] text-slate-400">
                <span>{inspectSession ? `Bản ghi của: ${inspectSession.name}` : 'Chọn phiên để soi bản ghi'}</span>
                <span>{inspectRecords.length} mẫu hiển thị</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 mt-2">
                {inspectRecords.length === 0 ? (
                  <p className="text-slate-600 text-center py-10">Không có dữ liệu bản ghi.</p>
                ) : (
                  inspectRecords.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-slate-900/60 text-slate-300">
                      <span className="text-slate-500">{r.timestamp.slice(11, 23)}</span>
                      <span className="text-cyan-400 font-bold">{r.display_address}</span>
                      <span className="truncate max-w-[80px] text-slate-400">{r.alias}</span>
                      <span className="text-amber-300 font-bold">{r.value} {r.unit}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
