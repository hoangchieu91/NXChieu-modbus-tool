import React, { useEffect, useState } from 'react';
import { X, Server, Play, Square, Radio, Cpu, Globe, Activity, HelpCircle } from 'lucide-react';
import { SerialPortDetail, SlaveConfig, SimulationConfig } from '../types/modbus';

const FieldTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative group inline-flex items-center ml-1.5 align-middle cursor-help">
    <HelpCircle className="w-3.5 h-3.5 text-amber-400/70 group-hover:text-amber-300 transition-colors" />
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-slate-800 text-slate-100 text-[11px] rounded-md shadow-2xl border border-slate-600 z-50 pointer-events-none leading-relaxed font-normal normal-case">
      {text}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
    </span>
  </span>
);

interface SlaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  isListening: boolean;
  currentConfig?: SlaveConfig;
  availablePorts: SerialPortDetail[];
  /** Resolves true when the server started successfully. */
  onStartServer: (config: SlaveConfig) => Promise<boolean>;
  onStopServer: () => void;
  onStartSim?: (config: SimulationConfig) => void;
  onStopSim?: () => void;
  isSimulating?: boolean;
}

export const SlaveModal: React.FC<SlaveModalProps> = ({
  isOpen,
  onClose,
  isListening,
  currentConfig,
  availablePorts,
  onStartServer,
  onStopServer,
  onStartSim,
  onStopSim,
  isSimulating,
}) => {
  const [tab, setTab] = useState<'tcp' | 'serial' | 'rtu_over_tcp'>(currentConfig?.type || 'tcp');

  // TCP
  const [tcpHost, setTcpHost] = useState<string>(currentConfig?.host || '0.0.0.0');
  const [tcpPort, setTcpPort] = useState<number>(currentConfig?.port_tcp || 5020);

  // Serial
  const [selectedPort, setSelectedPort] = useState<string>(currentConfig?.port || 'COM2');
  const [baudRate, setBaudRate] = useState<number>(currentConfig?.baud_rate || 9600);
  const dataBits = currentConfig?.data_bits || 8;
  const [parity, setParity] = useState<string>(currentConfig?.parity || 'none');
  const stopBits = currentConfig?.stop_bits || 1;

  // Slave ID
  const [slaveId, setSlaveId] = useState<number>(currentConfig?.slave_id || 1);
  const [slaveIdEnd, setSlaveIdEnd] = useState<number>(currentConfig?.slave_id_end || currentConfig?.slave_id || 1);
  const [enableRange, setEnableRange] = useState<boolean>(Boolean(currentConfig?.slave_id_end && currentConfig.slave_id_end > currentConfig.slave_id));

  // Auto Simulation
  const [simMode, setSimMode] = useState<'none' | 'random' | 'increment' | 'sine'>('none');
  const [simAddr, setSimAddr] = useState<number>(0);

  // The modal stays mounted across tabs, so re-sync the form with the active tab's config each
  // time it opens; otherwise it shows the previous tab's port/ID and risks a port conflict.
  useEffect(() => {
    if (!isOpen) return;
    setTab(currentConfig?.type || 'tcp');
    setTcpHost(currentConfig?.host || '0.0.0.0');
    setTcpPort(currentConfig?.port_tcp || 5020);
    setSelectedPort(currentConfig?.port || 'COM2');
    setBaudRate(currentConfig?.baud_rate || 9600);
    setParity(currentConfig?.parity || 'none');
    setSlaveId(currentConfig?.slave_id || 1);
    const end = currentConfig?.slave_id_end || currentConfig?.slave_id || 1;
    setSlaveIdEnd(end);
    setEnableRange(Boolean(currentConfig?.slave_id_end && currentConfig.slave_id_end > (currentConfig?.slave_id || 1)));
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  const handleStart = async () => {
    const cfg: SlaveConfig = {
      type: tab,
      slave_id: slaveId,
      slave_id_end: enableRange && slaveIdEnd >= slaveId ? slaveIdEnd : slaveId,
    };
    if (tab === 'serial') {
      cfg.port = selectedPort;
      cfg.baud_rate = baudRate;
      cfg.data_bits = dataBits;
      cfg.parity = parity;
      cfg.stop_bits = stopBits;
    } else {
      cfg.host = tcpHost;
      cfg.port_tcp = tcpPort;
    }
    const started = await onStartServer(cfg);
    if (!started) return; // keep the modal open so the user can fix the settings

    if (simMode !== 'none' && onStartSim) {
      onStartSim({
        session_id: '',
        table: 'holding',
        address: simAddr,
        mode: simMode,
        min: 200,
        max: 240,
        step: 1,
        interval_ms: 1000,
      });
    }
    onClose();
  };

  const handleStop = () => {
    onStopServer();
    if (onStopSim) onStopSim();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none">
      <div className="w-[520px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden font-sans text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/90 border-b border-slate-700 text-slate-100">
          <div className="flex items-center space-x-2 font-semibold">
            <Server className="w-4 h-4 text-amber-400" />
            <span>Thiết lập Modbus Slave</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Server Status Banner */}
        <div className={`px-4 py-2 flex items-center justify-between border-b ${
          isListening 
            ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300' 
            : 'bg-slate-950/60 border-slate-800 text-slate-400'
        }`}>
          <div className="flex items-center space-x-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className="font-medium">
              {isListening ? 'Server Đang Lắng Nghe Kết Nối (Running)' : 'Server Đang Dừng (Stopped)'}
            </span>
            {isSimulating && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] border border-amber-500/30">
                Mô phỏng đang chạy
              </span>
            )}
          </div>
          {isListening && (
            <button
              onClick={handleStop}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/30 font-medium text-[11px] transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Dừng Server</span>
            </button>
          )}
        </div>

        {/* Protocol Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-4 pt-2 space-x-2">
          <button
            onClick={() => setTab('tcp')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'tcp'
                ? 'bg-slate-900 border-slate-700 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Modbus TCP Server</span>
          </button>

          <button
            onClick={() => setTab('serial')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'serial'
                ? 'bg-slate-900 border-slate-700 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Serial RTU Slave</span>
          </button>

          <button
            onClick={() => setTab('rtu_over_tcp')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'rtu_over_tcp'
                ? 'bg-slate-900 border-slate-700 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>RTU over TCP</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-4 space-y-4">
          {/* Unit ID (Slave ID) & Multi-Slave Range */}
          <div className="p-2.5 bg-slate-950/50 border border-slate-800 rounded space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <label className="text-slate-300 font-medium">Slave ID (Unit ID):</label>
                <FieldTooltip text="Địa chỉ định danh của thiết bị Slave (1 - 247). Các gói tin Master gửi tới địa chỉ này sẽ được xử lý và phản hồi." />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={1}
                  max={247}
                  value={slaveId}
                  onChange={(e) => setSlaveId(Number(e.target.value))}
                  className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-amber-500 font-mono text-right"
                />
                {enableRange && (
                  <>
                    <span className="text-slate-500 font-bold">→</span>
                    <input
                      type="number"
                      min={slaveId}
                      max={247}
                      value={slaveIdEnd}
                      onChange={(e) => setSlaveIdEnd(Number(e.target.value))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-amber-300 font-mono text-right font-bold"
                      title="Slave ID kết thúc"
                    />
                  </>
                )}
              </div>
            </div>

            {/* Toggle Multi-Slave simulation range */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer text-slate-400 hover:text-slate-200">
                <input
                  type="checkbox"
                  checked={enableRange}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEnableRange(checked);
                    if (checked && slaveIdEnd <= slaveId) {
                      setSlaveIdEnd(Math.min(247, slaveId + 19)); // default to 20 slaves!
                    }
                  }}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-[11px] font-medium text-amber-400/90">
                  ⚡ Giả lập dải nhiều Slave cùng lúc (Multi-Slave Range)
                </span>
              </label>

              {enableRange && (
                <span className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded font-mono font-semibold">
                  Tổng: {Math.max(1, slaveIdEnd - slaveId + 1)} Slaves ({slaveId}..{slaveIdEnd})
                </span>
              )}
            </div>
          </div>

          {tab === 'tcp' && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center mb-1">
                  <label className="text-slate-300 font-medium">Listen Host (Địa chỉ lắng nghe):</label>
                  <FieldTooltip text="Dùng '0.0.0.0' để chấp nhận kết nối từ mọi máy trong mạng LAN, hoặc '127.0.0.1' nếu chỉ cho phép phần mềm nội bộ máy này kết nối." />
                </div>
                <input
                  type="text"
                  value={tcpHost}
                  onChange={(e) => setTcpHost(e.target.value)}
                  placeholder="0.0.0.0"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <div className="flex items-center mb-1">
                  <label className="text-slate-400">Listen Port:</label>
                  <FieldTooltip text="Cổng TCP để Master kết nối tới (tiêu chuẩn Modbus là 502, hoặc 5020 / 5502 nếu không muốn chạy quyền Admin)." />
                </div>
                <input
                  type="number"
                  value={tcpPort}
                  onChange={(e) => setTcpPort(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>
          )}

          {tab === 'serial' && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center">
                    <label className="text-slate-300 font-medium">Serial Port (Cổng COM Slave):</label>
                    <FieldTooltip text="Chọn cổng COM vật lý hoặc gõ tên cổng COM tùy ý (ví dụ COM49) nếu dùng cặp COM ảo hoặc driver ảo." />
                  </div>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={selectedPort}
                    onChange={(e) => setSelectedPort(e.target.value.toUpperCase().trim())}
                    placeholder="VD: COM49"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-mono font-bold"
                  />
                  <select
                    value={availablePorts.some((p) => p.port_name === selectedPort) ? selectedPort : ''}
                    onChange={(e) => {
                      if (e.target.value) setSelectedPort(e.target.value);
                    }}
                    className="w-48 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-400 focus:outline-none focus:border-amber-500 font-mono text-xs"
                  >
                    <option value="">-- Cổng phát hiện --</option>
                    {availablePorts.map((p) => (
                      <option key={p.port_name} value={p.port_name}>
                        {p.port_name} {p.description ? `(${p.description})` : ''}
                      </option>
                    ))}
                    {!availablePorts.some((p) => p.port_name === 'COM49') && (
                      <option value="COM49">COM49</option>
                    )}
                    {!availablePorts.some((p) => p.port_name === 'COM2') && (
                      <option value="COM2">COM2 (Virtual)</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400">Baud Rate:</label>
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                  >
                    {[4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                      <option key={b} value={b}>
                        {b} bps
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400">Parity:</label>
                  <select
                    value={parity}
                    onChange={(e) => setParity(e.target.value)}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="none">None (1 Stop bit)</option>
                    <option value="even">Even (Chẵn)</option>
                    <option value="odd">Odd (Lẻ)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab === 'rtu_over_tcp' && (
            <div className="space-y-3">
              <div className="p-2.5 bg-amber-950/30 border border-amber-800/40 rounded text-[11px] text-amber-300/90 leading-relaxed">
                <strong>RTU over TCP Server:</strong> Nhận các frame Modbus RTU (có CRC-16) qua TCP socket thô mà không có header MBAP.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400">Listen Host:</label>
                  <input
                    type="text"
                    value={tcpHost}
                    onChange={(e) => setTcpHost(e.target.value)}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400">Listen Port:</label>
                  <input
                    type="number"
                    value={tcpPort}
                    onChange={(e) => setTcpPort(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Auto Simulation Feature */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-slate-300 font-medium">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>Mô phỏng giá trị tự động</span>
              </div>
              <select
                value={simMode}
                onChange={(e) => setSimMode(e.target.value as any)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-[11px]"
              >
                <option value="none">Tắt mô phỏng</option>
                <option value="random">Dao động ngẫu nhiên (Random 200-240)</option>
                <option value="increment">Tăng dần (+1 sau mỗi 1s)</option>
                <option value="sine">Sóng sin tuần hoàn (Sine wave)</option>
              </select>
            </div>
            {simMode !== 'none' && (
              <div className="flex items-center space-x-2 text-[11px] text-slate-400 pt-1">
                <span>Áp dụng vào thanh ghi Holding:</span>
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={simAddr}
                  onChange={(e) => setSimAddr(Number(e.target.value))}
                  className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200 font-mono"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end px-4 py-2.5 bg-slate-800/80 border-t border-slate-700 space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            Đóng / Close
          </button>
          <button
            onClick={handleStart}
            className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-md shadow-amber-900/30 transition-colors flex items-center space-x-1"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Khởi Động Slave Server</span>
          </button>
        </div>
      </div>
    </div>
  );
};
