import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Play,
  Square,
  RefreshCw,
  Send,
  Trash2,
  Copy,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { SerialPortDetail, RawSerialFrame } from '../types/modbus';
import {
  listSerialPorts,
  rawSerialOpen,
  rawSerialClose,
  rawSerialSend,
  rawSerialSetDTR,
  rawSerialSetRTS,
  rawSerialIsOpen,
} from '../services/backend';

interface RawSerialStudioProps {
  onClose?: () => void;
}

const COMMON_BAUDS = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600,
];

export const RawSerialStudio: React.FC<RawSerialStudioProps> = () => {
  const [ports, setPorts] = useState<SerialPortDetail[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [dataBits, setDataBits] = useState<number>(8);
  const [parity, setParity] = useState<string>('none');
  const [stopBits, setStopBits] = useState<number>(1);

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Hardware Pins
  const [dtrState, setDtrState] = useState<boolean>(false);
  const [rtsState, setRtsState] = useState<boolean>(false);

  // Send controls
  const [sendMode, setSendMode] = useState<'hex' | 'ascii'>('ascii');
  const [inputText, setInputText] = useState<string>('AT\r\n');
  const [appendCrc, setAppendCrc] = useState<string>('none');
  const [lineEnding, setLineEnding] = useState<string>('crlf');
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [loopIntervalMs, setLoopIntervalMs] = useState<number>(1000);

  // Stream logs
  const [frames, setFrames] = useState<RawSerialFrame[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [txBytes, setTxBytes] = useState<number>(0);
  const [rxBytes, setRxBytes] = useState<number>(0);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const loopTimerRef = useRef<any>(null);

  const loadPorts = async () => {
    try {
      const p = await listSerialPorts();
      setPorts(p);
      if (!selectedPort && p.length > 0) {
        setSelectedPort(p[0].port_name);
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPorts();
    rawSerialIsOpen().then((open) => setIsConnected(open));

    // Listen for incoming frames
    const w = window as any;
    if (w.runtime && w.runtime.EventsOn) {
      w.runtime.EventsOn('raw-serial-frame', (frame: RawSerialFrame) => {
        setFrames((prev) => [...prev.slice(-999), frame]);
        if (frame.direction === 'rx') {
          setRxBytes((b) => b + frame.length);
        } else {
          setTxBytes((b) => b + frame.length);
        }
      });
      return () => {
        if (w.runtime.EventsOff) {
          w.runtime.EventsOff('raw-serial-frame');
        }
      };
    }
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [frames, autoScroll]);

  const formatPortLabel = (p: SerialPortDetail) => {
    const raw = `${p.description || ''} ${p.hardware_id || ''}`;
    const m = raw.match(/Ch\s*([A-H])/i);
    if (m) {
      return `${p.port_name} (Kênh ${m[1].toUpperCase()})`;
    }
    return `${p.port_name} (${(p.description || 'Serial').slice(0, 20)})`;
  };

  const handleConnectToggle = async () => {
    setIsBusy(true);
    setErrorMessage('');
    try {
      if (isConnected) {
        if (isLooping) {
          setIsLooping(false);
          if (loopTimerRef.current) clearInterval(loopTimerRef.current);
        }
        await rawSerialClose();
        setIsConnected(false);
      } else {
        if (!selectedPort) throw new Error('Vui lòng chọn cổng COM');
        await rawSerialOpen(selectedPort, baudRate, dataBits, parity, stopBits);
        setIsConnected(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggleDTR = async () => {
    try {
      const next = !dtrState;
      await rawSerialSetDTR(next);
      setDtrState(next);
    } catch (e: any) {
      setErrorMessage(e.message || String(e));
    }
  };

  const handleToggleRTS = async () => {
    try {
      const next = !rtsState;
      await rawSerialSetRTS(next);
      setRtsState(next);
    } catch (e: any) {
      setErrorMessage(e.message || String(e));
    }
  };

  // Pulse reset for ESP32/microcontroller
  const handlePulseReset = async () => {
    try {
      await rawSerialSetDTR(false);
      await rawSerialSetRTS(true);
      setTimeout(async () => {
        await rawSerialSetDTR(true);
        await rawSerialSetRTS(false);
        setTimeout(async () => {
          await rawSerialSetDTR(false);
        }, 100);
      }, 100);
    } catch (e: any) {
      setErrorMessage(e.message || String(e));
    }
  };

  const doSend = async (customText?: string) => {
    const textToSend = customText !== undefined ? customText : inputText;
    if (!textToSend.trim()) return;

    let payload = textToSend;
    if (sendMode === 'ascii') {
      if (lineEnding === 'crlf' && !payload.endsWith('\r\n')) payload += '\r\n';
      else if (lineEnding === 'lf' && !payload.endsWith('\n')) payload += '\n';
      else if (lineEnding === 'cr' && !payload.endsWith('\r')) payload += '\r';
    }

    try {
      await rawSerialSend(payload, sendMode === 'hex', appendCrc);
      setErrorMessage('');
    } catch (e: any) {
      setErrorMessage(e.message || String(e));
    }
  };

  const handleToggleLoop = () => {
    if (isLooping) {
      setIsLooping(false);
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    } else {
      setIsLooping(true);
      doSend();
      loopTimerRef.current = setInterval(
        () => {
          doSend();
        },
        Math.max(100, loopIntervalMs)
      );
    }
  };

  useEffect(() => {
    return () => {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    };
  }, []);

  const handleClearLog = () => {
    setFrames([]);
    setTxBytes(0);
    setRxBytes(0);
  };

  const handleCopyLog = () => {
    const text = frames
      .map((f) => `[${f.timestamp}] [${f.direction.toUpperCase()}] HEX: ${f.hex} | ASCII: ${f.ascii}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Bar Config */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-cyan-500/30 text-cyan-400">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Raw Serial &amp; TTL UART Terminal
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                HARDWARE DEBUG
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Kiểm tra giao tiếp thô UART/TTL, Modbus RTU, AT Commands, ESP32, vi điều khiển
            </p>
          </div>
        </div>

        {/* Connection Bar */}
        <div className="flex items-center gap-2">
          {/* Port */}
          <select
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={isConnected}
            className="h-9 bg-slate-950 border border-slate-700 rounded-lg px-2.5 text-xs text-slate-200 outline-none focus:border-cyan-500 max-w-[200px]"
          >
            {ports.map((p) => (
              <option key={p.port_name} value={p.port_name}>
                {formatPortLabel(p)}
              </option>
            ))}
          </select>

          {/* Baudrate */}
          <select
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            disabled={isConnected}
            className="h-9 bg-slate-950 border border-slate-700 rounded-lg px-2.5 text-xs font-mono font-bold text-cyan-300 outline-none focus:border-cyan-500"
          >
            {COMMON_BAUDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          {/* Format */}
          <select
            value={`${dataBits}-${parity.charAt(0).toUpperCase()}-${stopBits}`}
            onChange={(e) => {
              const [db, p, sb] = e.target.value.split('-');
              setDataBits(Number(db));
              setParity(p === 'N' ? 'none' : p === 'E' ? 'even' : 'odd');
              setStopBits(Number(sb));
            }}
            disabled={isConnected}
            className="h-9 bg-slate-950 border border-slate-700 rounded-lg px-2 text-xs font-mono text-slate-300 outline-none focus:border-cyan-500"
          >
            <option value="8-N-1">8-N-1</option>
            <option value="8-E-1">8-E-1</option>
            <option value="8-O-1">8-O-1</option>
            <option value="7-E-1">7-E-1</option>
            <option value="7-O-1">7-O-1</option>
          </select>

          <button
            onClick={loadPorts}
            disabled={isConnected}
            title="Làm mới cổng COM"
            className="h-9 w-9 grid place-items-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Connect Button */}
          <button
            onClick={handleConnectToggle}
            disabled={isBusy}
            className={`flex items-center gap-2 h-9 px-4 rounded-lg font-bold text-xs transition shadow-md ${
              isConnected
                ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
            }`}
          >
            {isConnected ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Ngắt Kết Nối</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Mở Cổng TTL</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Hardware Pins & Status Ribbon */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-slate-800 bg-slate-900/50 text-xs text-slate-300 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-slate-600'}`}
            />
            <span className="font-semibold">
              {isConnected ? `Đang mở: ${selectedPort} @ ${baudRate} bps` : 'Cổng chưa mở'}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Pin Controls */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold text-[10px] uppercase">Chân Pin:</span>
            <button
              onClick={handleToggleDTR}
              disabled={!isConnected}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                dtrState
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              } disabled:opacity-40`}
            >
              DTR: {dtrState ? 'HIGH' : 'LOW'}
            </button>
            <button
              onClick={handleToggleRTS}
              disabled={!isConnected}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                rtsState
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              } disabled:opacity-40`}
            >
              RTS: {rtsState ? 'HIGH' : 'LOW'}
            </button>
            <button
              onClick={handlePulseReset}
              disabled={!isConnected}
              title="Gửi xung DTR/RTS để reset ESP32 / Arduino"
              className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-semibold transition disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3 text-cyan-400" />
              <span>Reset ESP32</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="text-cyan-400">TX: {txBytes} bytes</span>
          <span className="text-emerald-400">RX: {rxBytes} bytes</span>
          <span className="text-slate-500">{frames.length} frames</span>
        </div>
      </div>

      {/* Main Terminal Area */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-4">
        {/* Frame Log Box */}
        <div className="flex-1 flex flex-col bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden min-h-0">
          {/* Stream Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/90 shrink-0">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-cyan-400" /> Luồng Dữ Liệu Truyền Nhận (Terminal Log)
            </span>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-400 mr-2">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
                />
                <span>Tự cuộn</span>
              </label>

              <button
                onClick={handleCopyLog}
                title="Sao chép toàn bộ"
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleClearLog}
                title="Xóa màn hình"
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Frames Feed */}
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5 select-text"
          >
            {frames.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs">
                <Terminal className="w-8 h-8 mb-2 stroke-1" />
                <p>Chưa có dữ liệu nào trên cổng serial.</p>
                <p className="text-[10px] text-slate-600 mt-1">
                  Mở cổng và gửi lệnh bên dưới hoặc chờ tín hiệu từ thiết bị truyền lên.
                </p>
              </div>
            ) : (
              frames.map((f, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-2.5 py-1.5 rounded-lg border transition ${
                    f.direction === 'tx'
                      ? 'bg-cyan-950/20 border-cyan-500/20 text-cyan-300'
                      : 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
                  }`}
                >
                  <span className="text-[10px] text-slate-500 shrink-0">{f.timestamp}</span>

                  <span
                    className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                      f.direction === 'tx'
                        ? 'bg-cyan-500/20 text-cyan-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {f.direction === 'tx' ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownLeft className="w-3 h-3" />
                    )}
                    {f.direction.toUpperCase()} ({f.length})
                  </span>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 overflow-hidden">
                    <span className="font-mono text-slate-200 break-all select-all font-semibold">
                      {f.hex}
                    </span>
                    <span className="font-mono text-slate-400 break-all border-l border-slate-800/80 pl-2">
                      {f.ascii}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="mt-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
            {errorMessage}
          </div>
        )}

        {/* Send Input Panel */}
        <div className="mt-3 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-300">Định Dạng Gửi:</span>
              <div className="flex border border-slate-700 rounded-lg p-0.5 bg-slate-950">
                <button
                  onClick={() => setSendMode('ascii')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    sendMode === 'ascii' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ASCII / Text
                </button>
                <button
                  onClick={() => setSendMode('hex')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    sendMode === 'hex' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  HEX (Hexadecimal)
                </button>
              </div>

              {sendMode === 'ascii' && (
                <select
                  value={lineEnding}
                  onChange={(e) => setLineEnding(e.target.value)}
                  className="h-7 bg-slate-950 border border-slate-700 rounded px-2 text-[11px] text-slate-300 outline-none"
                >
                  <option value="none">Không ký tự kết thúc</option>
                  <option value="crlf">\r\n (CRLF)</option>
                  <option value="lf">\n (LF)</option>
                  <option value="cr">\r (CR)</option>
                </select>
              )}

              <select
                value={appendCrc}
                onChange={(e) => setAppendCrc(e.target.value)}
                className="h-7 bg-slate-950 border border-slate-700 rounded px-2 text-[11px] text-slate-300 outline-none"
              >
                <option value="none">Không thêm Checksum</option>
                <option value="crc16_modbus">+ Modbus CRC-16 (Little Endian)</option>
                <option value="crc16_be">+ CRC-16 (Big Endian)</option>
                <option value="sum8">+ Checksum 8-bit</option>
                <option value="xor">+ XOR (BCC)</option>
              </select>
            </div>

            {/* Loop Repeater */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleLoop}
                disabled={!isConnected}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition ${
                  isLooping
                    ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                } disabled:opacity-40`}
              >
                {isLooping ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                <span>Gửi lặp lại</span>
              </button>

              <input
                type="number"
                value={loopIntervalMs}
                onChange={(e) => setLoopIntervalMs(Number(e.target.value))}
                min={50}
                step={100}
                className="w-16 h-7 bg-slate-950 border border-slate-700 rounded px-2 text-[11px] text-center text-slate-200 outline-none"
              />
              <span className="text-[10px] text-slate-500">ms</span>
            </div>
          </div>

          {/* Quick Macros */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-slate-500 text-[10px] font-semibold uppercase shrink-0">Lệnh mẫu:</span>
            {[
              { label: 'AT', val: 'AT\r\n', mode: 'ascii' as const },
              { label: 'AT+GMR', val: 'AT+GMR\r\n', mode: 'ascii' as const },
              { label: 'AT+CSQ', val: 'AT+CSQ\r\n', mode: 'ascii' as const },
              { label: 'Modbus FC03 ID1 Reg0', val: '01 03 00 00 00 02 C4 0B', mode: 'hex' as const },
              { label: 'Modbus FC01 Coil ID1', val: '01 01 00 00 00 08 3D CC', mode: 'hex' as const },
              { label: 'Ping \\r\\n', val: 'PING\r\n', mode: 'ascii' as const },
            ].map((m, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setSendMode(m.mode);
                  setInputText(m.val);
                  if (isConnected) doSend(m.val);
                }}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[10px] font-mono shrink-0 transition"
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Input text & Send Button */}
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSend();
              }}
              placeholder={
                sendMode === 'hex'
                  ? 'Nhập mã Hex (VD: 01 03 00 00 00 02 hoặc 0x01 0x03)'
                  : 'Nhập chuỗi ký tự ASCII (VD: AT+GMR)'
              }
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-cyan-500"
            />

            <button
              onClick={() => doSend()}
              disabled={!isConnected}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Gửi (Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
