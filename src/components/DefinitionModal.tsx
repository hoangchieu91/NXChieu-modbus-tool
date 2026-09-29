import React, { useState, useEffect } from 'react';
import { X, Settings, Check, HelpCircle } from 'lucide-react';
import { PollDefinition } from '../types/modbus';
import { parseModbusAddress, formatModbusAddress } from '../utils/formatters';

interface DefinitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  definition: PollDefinition;
  onSave: (def: PollDefinition) => void;
}

const FieldTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative group inline-flex items-center ml-1.5 align-middle cursor-help">
    <HelpCircle className="w-3.5 h-3.5 text-cyan-400/70 group-hover:text-cyan-300 transition-colors" />
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-slate-800 text-slate-100 text-[11px] rounded-md shadow-2xl border border-slate-600 z-50 pointer-events-none leading-relaxed font-normal normal-case">
      {text}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
    </span>
  </span>
);

export const DefinitionModal: React.FC<DefinitionModalProps> = ({
  isOpen,
  onClose,
  definition,
  onSave,
}) => {
  const [slaveId, setSlaveId] = useState(definition.slave_id);
  const [functionCode, setFunctionCode] = useState(definition.function_code);
  const [address, setAddress] = useState(definition.start_address);
  const [addrMode, setAddrMode] = useState<'dec' | 'hex'>('dec');
  const [addrInput, setAddrInput] = useState<string>(String(definition.start_address));
  const [addrError, setAddrError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(definition.quantity);
  const [scanRate, setScanRate] = useState(definition.scan_rate_ms);

  useEffect(() => {
    setSlaveId(definition.slave_id);
    setFunctionCode(definition.function_code);
    setAddress(definition.start_address);
    setAddrInput(
      addrMode === 'hex'
        ? formatModbusAddress(definition.start_address, 'hex')
        : String(definition.start_address)
    );
    setAddrError(null);
    setQuantity(definition.quantity);
    setScanRate(definition.scan_rate_ms);
  }, [definition, isOpen]);

  const handleToggleAddrMode = (mode: 'dec' | 'hex') => {
    if (mode === addrMode) return;
    setAddrMode(mode);
    if (mode === 'hex') {
      setAddrInput(formatModbusAddress(address, 'hex'));
    } else {
      setAddrInput(formatModbusAddress(address, 'dec'));
    }
    setAddrError(null);
  };

  const handleAddressChange = (valStr: string) => {
    setAddrInput(valStr);
    const parsed = parseModbusAddress(valStr, addrMode);
    if (parsed.isValid) {
      setAddress(parsed.value);
      setAddrError(null);
    } else {
      setAddrError(parsed.error || 'Địa chỉ không hợp lệ');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseModbusAddress(addrInput, addrMode);
    const finalAddress = parsed.isValid ? parsed.value : address;

    onSave({
      slave_id: Math.max(1, Math.min(247, slaveId)),
      function_code: functionCode,
      start_address: Math.max(0, Math.min(65535, finalAddress)),
      quantity: Math.max(1, Math.min(125, quantity)),
      scan_rate_ms: Math.max(50, scanRate),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none">
      <div className="w-[480px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden font-sans text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/90 border-b border-slate-700 text-slate-100">
          <div className="flex items-center space-x-2 font-semibold">
            <Settings className="w-4 h-4 text-cyan-400" />
            <span>Read/Write Definition (Cấu Hình Quét - F8)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} noValidate className="p-4 space-y-4">
          {/* Slave ID */}
          <div>
            <div className="flex items-center mb-1">
              <label className="text-slate-300 font-medium">
                Slave ID (Địa chỉ trạm 1 - 247):
              </label>
              <FieldTooltip text="Địa chỉ nhận diện của thiết bị trên mạng Modbus (từ 1 đến 247). Mỗi đồng hồ điện, biến tần hay PLC trên cùng đường RS-485 phải có Slave ID riêng biệt." />
            </div>
            <input
              type="number"
              min={1}
              max={247}
              value={slaveId}
              onChange={(e) => setSlaveId(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              required
            />
          </div>

          {/* Function Code */}
          <div>
            <div className="flex items-center mb-1">
              <label className="text-slate-300 font-medium">
                Function Code (Mã hàm đọc):
              </label>
              <FieldTooltip text="Mã lệnh Modbus chuẩn: FC 03 (Holding) đọc thông số cấu hình và đo lường PLC/biến tần; FC 04 (Input) đọc cảm biến đo lường; FC 01 (Coil) đọc rơ-le ngõ ra; FC 02 (Discrete) đọc ngõ vào số DI." />
            </div>
            <select
              value={functionCode}
              onChange={(e) => setFunctionCode(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value={3}>03: Read Holding Registers (4x - Thường dùng nhất)</option>
              <option value={4}>04: Read Input Registers (3x - Cảm biến / Đồng hồ đo)</option>
              <option value={1}>01: Read Coils (0x - Relay / Ngõ ra số)</option>
              <option value={2}>02: Read Discrete Inputs (1x - Ngõ vào số DI)</option>
            </select>
          </div>

          {/* Start Address & Quantity in 2 cols */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center">
                  <label className="text-slate-300 font-medium">
                    Start Address:
                  </label>
                  <FieldTooltip text="Địa chỉ thanh ghi bắt đầu tính từ 0. Bấm DEC hoặc HEX để chuyển chế độ nhập. Hệ thống cũng tự động nhận dạng tiền tố '0x' hoặc hậu tố 'H' (ví dụ: 0x1000 hoặc 1000h)." />
                </div>
                {/* Segmented Pill DEC / HEX */}
                <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-700/80 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => handleToggleAddrMode('dec')}
                    className={`px-1.5 py-0.5 rounded transition ${
                      addrMode === 'dec'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    DEC
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleAddrMode('hex')}
                    className={`px-1.5 py-0.5 rounded transition ${
                      addrMode === 'hex'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    HEX
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={addrInput}
                onChange={(e) => handleAddressChange(e.target.value)}
                placeholder={addrMode === 'hex' ? '0x0000 hoặc 1000' : '0 đến 65535'}
                className={`w-full bg-slate-950 border rounded px-2.5 py-1.5 text-slate-200 focus:outline-none font-mono ${
                  addrError
                    ? 'border-rose-500 focus:border-rose-500 text-rose-300'
                    : 'border-slate-700 focus:border-cyan-500'
                }`}
                required
              />
              {addrError ? (
                <span className="text-[10px] text-rose-400 mt-0.5 block">{addrError}</span>
              ) : (
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 font-mono">
                  <span>
                    {addrMode === 'dec' ? (
                      <>Hex: <span className="text-purple-400 font-bold">{formatModbusAddress(address, 'hex')}</span></>
                    ) : (
                      <>Dec: <span className="text-cyan-400 font-bold">{address}</span></>
                    )}
                  </span>
                  <span className="text-slate-500 font-sans">
                    PLC: {functionCode === 3 ? 40001 + address : functionCode === 4 ? 30001 + address : address + 1}
                  </span>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center mb-1">
                <label className="text-slate-400">
                  Quantity (Số lượng 1 - 125):
                </label>
                <FieldTooltip text="Số lượng thanh ghi cần đọc liên tục trong 1 gói tin. Chuẩn Modbus RTU giới hạn tối đa 125 thanh ghi (250 bytes) mỗi chu kỳ." />
              </div>
              <input
                type="number"
                min={1}
                max={125}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                required
              />
            </div>
          </div>

          {/* Scan Rate */}
          <div>
            <div className="flex items-center mb-1">
              <label className="text-slate-300 font-medium">
                Scan Rate (Chu kỳ quét định kỳ - ms):
              </label>
              <FieldTooltip text="Khoảng thời gian chờ giữa 2 lần gửi gói tin quét (ms). Với đường truyền RS-485 nên đặt từ 200ms đến 1000ms để tránh nghẽn đường dây. Với Modbus TCP có thể đặt nhanh 50ms - 100ms." />
            </div>
            <input
              type="number"
              min={10}
              step="any"
              value={scanRate}
              onChange={(e) => setScanRate(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              required
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Mặc định: 1000ms (1 giây). Khuyến nghị: &ge; 200ms cho Serial RS-485.
            </span>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end pt-3 border-t border-slate-800 space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-900/30 transition-colors flex items-center space-x-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Áp Dụng (OK)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
