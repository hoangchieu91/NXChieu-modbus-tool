import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Cpu, Globe, Server, Check, HelpCircle, Radio } from 'lucide-react';
import { ConnectionConfig, SerialPortDetail } from '../types/modbus';

const FieldTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative group inline-flex items-center ml-1.5 align-middle cursor-help">
    <HelpCircle className="w-3.5 h-3.5 text-cyan-400/70 group-hover:text-cyan-300 transition-colors" />
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-slate-800 text-slate-100 text-[11px] rounded-md shadow-2xl border border-slate-600 z-50 pointer-events-none leading-relaxed font-normal normal-case">
      {text}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
    </span>
  </span>
);

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => Promise<boolean>;
  availablePorts: SerialPortDetail[];
  onRefreshPorts: () => void;
  currentConfig: ConnectionConfig | null;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  availablePorts,
  onRefreshPorts,
  currentConfig,
}) => {
  const [tab, setTab] = useState<'serial' | 'tcp' | 'rtu_over_tcp' | 'simulator'>('serial');

  // Serial state
  const [selectedPort, setSelectedPort] = useState<string>('COM1');
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [dataBits, setDataBits] = useState<number>(8);
  const [parity, setParity] = useState<string>('none');
  const [stopBits, setStopBits] = useState<number>(1);
  const [serialTimeout, setSerialTimeout] = useState<number>(1000);

  // TCP / RTU over TCP state
  const [tcpHost, setTcpHost] = useState<string>('127.0.0.1');
  const [tcpPort, setTcpPort] = useState<number>(502);
  const [tcpTimeout, setTcpTimeout] = useState<number>(1000);

  const [formError, setFormError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // The <select> can only show listed ports. If the selected one is not listed (never scanned,
  // or unplugged), pick the first listed port so what is shown is what gets opened.
  useEffect(() => {
    if (availablePorts.length > 0 && !availablePorts.some((p) => p.port_name === selectedPort)) {
      setSelectedPort(availablePorts[0].port_name);
    }
  }, [availablePorts, selectedPort]);

  useEffect(() => {
    if (isOpen) setFormError(null);
  }, [isOpen]);

  useEffect(() => {
    if (currentConfig) {
      if (currentConfig.type === 'serial') {
        if (currentConfig.port.toLowerCase() === 'simulator') {
          setTab('simulator');
        } else {
          setTab('serial');
          setSelectedPort(currentConfig.port);
          setBaudRate(currentConfig.baud_rate);
          setDataBits(8); // Modbus RTU always uses 8 data bits
          setParity(currentConfig.parity);
          setStopBits(currentConfig.stop_bits);
          setSerialTimeout(currentConfig.timeout_ms);
        }
      } else if (currentConfig.type === 'rtu_over_tcp') {
        setTab('rtu_over_tcp');
        setTcpHost(currentConfig.host);
        setTcpPort(currentConfig.port);
        setTcpTimeout(currentConfig.timeout_ms);
      } else {
        setTab('tcp');
        setTcpHost(currentConfig.host);
        setTcpPort(currentConfig.port);
        setTcpTimeout(currentConfig.timeout_ms);
      }
    }
  }, [currentConfig, isOpen]);

  if (!isOpen) return null;

  const isIntIn = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

  // Go receives these as unsigned integers; reject what it cannot decode, with a clear message.
  const validate = (): string | null => {
    if (tab === 'serial') {
      if (!selectedPort) return 'Chưa chọn cổng COM.';
      if (!isIntIn(baudRate, 300, 4000000)) return 'Baudrate không hợp lệ.';
      if (!isIntIn(serialTimeout, 20, 60000)) return 'Timeout phải là số nguyên từ 20 đến 60000 ms.';
    } else if (tab === 'tcp' || tab === 'rtu_over_tcp') {
      const host = tcpHost.trim();
      if (!host || /\s/.test(host)) return 'Địa chỉ IP / Host không hợp lệ.';
      if (!isIntIn(tcpPort, 1, 65535)) return 'Port TCP phải là số nguyên từ 1 đến 65535.';
      if (!isIntIn(tcpTimeout, 20, 60000)) return 'Timeout phải là số nguyên từ 20 đến 60000 ms.';
    }
    return null;
  };

  const handleConnect = async () => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    let config: ConnectionConfig;
    if (tab === 'serial') {
      config = {
        type: 'serial',
        port: selectedPort,
        baud_rate: baudRate,
        data_bits: dataBits,
        parity: parity,
        stop_bits: stopBits,
        timeout_ms: serialTimeout,
      };
    } else if (tab === 'tcp' || tab === 'rtu_over_tcp') {
      config = {
        type: tab,
        host: tcpHost.trim(),
        port: tcpPort,
        timeout_ms: tcpTimeout,
      };
    } else {
      // Simulator
      config = {
        type: 'serial',
        port: 'simulator',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        timeout_ms: 1000,
      };
    }
    setConnecting(true);
    try {
      const connected = await onConnect(config);
      if (connected) onClose();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 select-none">
      <div className="w-[520px] bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden font-sans text-xs animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/70 border-b border-slate-800 text-slate-100">
          <div className="flex items-center space-x-2.5 font-semibold text-sm">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Server className="w-4 h-4" />
            </div>
            <span>Thiết lập kết nối Modbus</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-4 pt-2 space-x-2 overflow-x-auto">
          <button
            onClick={() => setTab('serial')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'serial'
                ? 'bg-slate-900 border-slate-700 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Serial RTU</span>
          </button>

          <button
            onClick={() => setTab('tcp')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'tcp'
                ? 'bg-slate-900 border-slate-700 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Modbus TCP</span>
          </button>

          <button
            onClick={() => setTab('rtu_over_tcp')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'rtu_over_tcp'
                ? 'bg-slate-900 border-slate-700 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>RTU over TCP</span>
          </button>

          <button
            onClick={() => setTab('simulator')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t font-medium transition-colors border-t border-x ${
              tab === 'simulator'
                ? 'bg-slate-900 border-slate-700 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-indigo-300'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Simulator</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-4 space-y-4">
          {tab === 'serial' && (
            <div className="space-y-3">
              {/* Port selector with refresh */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center">
                    <label className="text-slate-300 font-medium">Serial Port (Cổng COM):</label>
                    <FieldTooltip text="Chọn cổng COM vật lý hoặc USB-RS485 cắm vào máy tính. Bấm nút 'Quét Cổng COM' bên cạnh để làm mới danh sách cổng vừa cắm." />
                  </div>
                  <button
                    onClick={onRefreshPorts}
                    className="flex items-center space-x-1 text-[11px] text-cyan-400 hover:text-cyan-300"
                    title="Scan lại danh sách cổng COM"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Quét Cổng COM</span>
                  </button>
                </div>
                <select
                  value={selectedPort}
                  onChange={(e) => setSelectedPort(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  {availablePorts.length === 0 ? (
                    <option value="COM1">COM1 (Không tìm thấy cổng phần cứng)</option>
                  ) : (
                    availablePorts.map((p) => (
                      <option key={p.port_name} value={p.port_name}>
                        {p.port_name} {p.description ? `(${p.description})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Grid 2 cols for Serial settings */}
              <div className="grid grid-cols-2 gap-3">
                {/* Baudrate */}
                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">Baud Rate:</label>
                    <FieldTooltip text="Tốc độ baud truyền dữ liệu (bps). Thiết bị công nghiệp thường dùng 9600, 19200 hoặc 115200 bps." />
                  </div>
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                      <option key={b} value={b}>
                        {b} bps
                      </option>
                    ))}
                  </select>
                </div>

                {/* Data Bits */}
                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">Data Bits:</label>
                    <FieldTooltip text="Số bit dữ liệu trên mỗi byte truyền (chuẩn Modbus RTU luôn là 8 bits)." />
                  </div>
                  <select
                    value={dataBits}
                    onChange={(e) => setDataBits(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value={8}>8 bits</option>
                  </select>
                </div>

                {/* Parity */}
                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">Parity:</label>
                    <FieldTooltip text="Bit chẵn lẻ kiểm tra lỗi truyền (None = Không, Even = Chẵn, Odd = Lẻ). Đa số thiết bị dùng None." />
                  </div>
                  <select
                    value={parity}
                    onChange={(e) => setParity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="none">None Parity (N)</option>
                    <option value="even">Even Parity (E)</option>
                    <option value="odd">Odd Parity (O)</option>
                  </select>
                </div>

                {/* Stop Bits */}
                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">Stop Bits:</label>
                    <FieldTooltip text="Số bit dừng kết thúc khung truyền (thường là 1 Stop bit khi không có Parity)." />
                  </div>
                  <select
                    value={stopBits}
                    onChange={(e) => setStopBits(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value={1}>1 Stop Bit</option>
                    <option value={2}>2 Stop Bits</option>
                  </select>
                </div>
              </div>

              {/* Response Timeout */}
              <div>
                <div className="flex items-center mb-1">
                  <label className="text-slate-400">Response Timeout (ms):</label>
                  <FieldTooltip text="Thời gian tối đa chờ thiết bị phản hồi dữ liệu trước khi báo lỗi Timeout (khuyến nghị 1000ms cho RS-485)." />
                </div>
                <input
                  type="number"
                  min={10}
                  step="1"
                  value={serialTimeout}
                  onChange={(e) => setSerialTimeout(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
          )}

          {(tab === 'tcp' || tab === 'rtu_over_tcp') && (
            <div className="space-y-3">
              {tab === 'rtu_over_tcp' && (
                <div className="p-2.5 bg-cyan-950/30 border border-cyan-800/40 rounded text-[11px] text-cyan-300/90 leading-relaxed">
                  <strong>RTU over TCP:</strong> Dành cho bộ chuyển đổi RS-485 sang Ethernet (như Moxa NPort, USR-TCP232, Waveshare Serial Server...) đóng gói trực tiếp frame Modbus RTU (kèm CRC-16) qua TCP socket thô.
                </div>
              )}

              <div>
                <div className="flex items-center mb-1">
                  <label className="text-slate-300 font-medium">IP Address / Hostname:</label>
                  <FieldTooltip
                    text={
                      tab === 'tcp'
                        ? 'Địa chỉ IP của Modbus Gateway hoặc PLC (ví dụ 192.168.1.100).'
                        : 'Địa chỉ IP của bộ chuyển đổi Serial-to-Ethernet (ví dụ 192.168.1.200).'
                    }
                  />
                </div>
                <input
                  type="text"
                  value={tcpHost}
                  onChange={(e) => setTcpHost(e.target.value)}
                  placeholder={tab === 'tcp' ? 'e.g. 192.168.1.100' : 'e.g. 192.168.1.200'}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">TCP Port:</label>
                    <FieldTooltip
                      text={
                        tab === 'tcp'
                          ? 'Cổng Modbus TCP tiêu chuẩn (mặc định luôn là cổng 502).'
                          : 'Cổng lắng nghe trên bộ chuyển đổi (thường là 502, 5020, hoặc 4001 tuỳ hãng).'
                      }
                    />
                  </div>
                  <input
                    type="number"
                    value={tcpPort}
                    onChange={(e) => setTcpPort(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center mb-1">
                    <label className="text-slate-400">Timeout (ms):</label>
                    <FieldTooltip
                      text={
                        tab === 'tcp'
                          ? 'Thời gian tối đa chờ phản hồi qua mạng TCP (khuyến nghị 1000ms).'
                          : 'Thời gian tối đa chờ phản hồi qua mạng (khuyến nghị 1000ms).'
                      }
                    />
                  </div>
                  <input
                    type="number"
                    min={10}
                    step="1"
                    value={tcpTimeout}
                    onChange={(e) => setTcpTimeout(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 'simulator' && (
            <div className="p-3 bg-indigo-950/40 border border-indigo-700/50 rounded space-y-2">
              <div className="flex items-center space-x-2 text-indigo-300 font-semibold">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Chế độ Giả Lập Trực Tiếp (Virtual Power Meter)</span>
              </div>
              <p className="text-slate-300 leading-relaxed text-[11px]">
                Mô phỏng đồng hồ điện 3 pha đo lường thực tế:
              </p>
              <ul className="list-disc list-inside text-slate-400 space-y-0.5 pl-1 text-[11px]">
                <li><strong className="text-slate-300">40001 (0x0000):</strong> Điện áp Pha A (220.5 V) kèm dao động nhẹ</li>
                <li><strong className="text-slate-300">40002 (0x0001):</strong> Dòng điện Pha A (5.12 A)</li>
                <li><strong className="text-slate-300">40003 (0x0002):</strong> Công suất P (1128 W)</li>
                <li><strong className="text-slate-300">40004 (0x0003):</strong> Hệ số công suất PF (0.98)</li>
                <li><strong className="text-slate-300">40005 (0x0004):</strong> Tần số (50.01 Hz)</li>
                <li>Hỗ trợ ghi thanh ghi (Write) trực tiếp để thử nghiệm logic.</li>
              </ul>
            </div>
          )}
        </div>

        {formError && (
          <div className="mx-4 mb-2 p-2.5 rounded bg-rose-950/60 border border-rose-700/60 text-rose-300 text-[11px]">
            {formError}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end px-4 py-2.5 bg-slate-800/80 border-t border-slate-700 space-x-2">
          <button
            disabled={connecting}
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40"
          >
            Hủy
          </button>
          <button
            disabled={connecting}
            onClick={handleConnect}
            className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-900/30 transition-colors flex items-center space-x-1 disabled:cursor-wait disabled:opacity-60"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{connecting ? 'Đang kết nối…' : 'Kết nối'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
