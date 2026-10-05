import React, { useState } from 'react';
import {
  X,
  Sliders,
  LineChart,
  Check,
  Send,
  Zap,
  Info,
} from 'lucide-react';
import { DataFormat, RegisterRow } from '../types/modbus';

interface QuickInspectorProps {
  selectedRow: RegisterRow | null;
  isCoil: boolean;
  isReadOnly?: boolean;
  sheetFormat: DataFormat;
  onClose: () => void;
  onUpdateAlias: (address: number, alias: string) => void;
  onUpdateUnit: (address: number, unit: string) => void;
  onUpdateScaling: (address: number, scaling: number) => void;
  onUpdateFormat?: (address: number, format: DataFormat) => void;
  onInlineWrite: (address: number, valueStr: string) => void;
  onToggleCoil: (address: number, currentVal: boolean) => void;
  onOpenChart?: (row: RegisterRow) => void;
  isTracing?: boolean;
}

const formatOptions: Array<[DataFormat, string]> = [
  ['unsigned16', 'Unsigned 16-bit (0..65535)'],
  ['signed16', 'Signed 16-bit (-32768..32767)'],
  ['hex16', 'Hex (0x...)'],
  ['bin16', 'Binary (16-bit)'],
  ['float_abcd', 'Float 32 (ABCD - Big Endian)'],
  ['float_cdab', 'Float 32 (CDAB - Word Swap)'],
  ['float_badc', 'Float 32 (BADC - Byte Swap)'],
  ['float_dcba', 'Float 32 (DCBA - Little Endian)'],
  ['long_abcd', 'Int 32 (ABCD Signed)'],
  ['long_cdab', 'Int 32 (CDAB Signed)'],
  ['uint32_abcd', 'UInt 32 (ABCD Unsigned)'],
  ['uint32_cdab', 'UInt 32 (CDAB Unsigned)'],
  ['water_48_be', '🌊 Đồng Hồ Nước 48-bit (BE)'],
  ['water_48_le', '🌊 Đồng Hồ Nước 48-bit (LE)'],
  ['water_48_bcd', '🌊 Đồng Hồ Nước 48-bit BCD'],
  ['int64', 'Int 64 (4 Regs Signed)'],
  ['uint64', 'UInt 64 (4 Regs Unsigned)'],
  ['ascii', 'ASCII Text'],
];

export const QuickInspector: React.FC<QuickInspectorProps> = ({
  selectedRow,
  isCoil,
  isReadOnly = false,
  sheetFormat,
  onClose,
  onUpdateAlias,
  onUpdateUnit,
  onUpdateScaling,
  onUpdateFormat,
  onInlineWrite,
  onToggleCoil,
  onOpenChart,
  isTracing = false,
}) => {
  const [writeValue, setWriteValue] = useState('');
  const [justCommitted, setJustCommitted] = useState(false);

  if (!selectedRow) {
    return (
      <div className="w-80 shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
        <Sliders className="w-8 h-8 text-slate-700 mb-2" />
        <span className="font-semibold text-slate-400">Chưa chọn thanh ghi</span>
        <p className="mt-1 text-[11px] text-slate-600">
          Nhấp chuột vào bất kỳ dòng nào trong bảng để xem chi tiết và ghi nhanh giá trị.
        </p>
      </div>
    );
  }

  const handleCommitWrite = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isReadOnly || !writeValue.trim()) return;
    onInlineWrite(selectedRow.address, writeValue.trim());
    setJustCommitted(true);
    setTimeout(() => setJustCommitted(false), 1200);
  };

  return (
    <div className="w-80 shrink-0 border-l border-slate-800 bg-slate-950/95 flex flex-col h-full font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center space-x-1.5">
          <Sliders className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-slate-200">Point Inspector</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Đóng Inspector"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-4 text-xs">
        {/* Live Value Card */}
        <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 shadow-inner">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-mono text-cyan-400 font-semibold">{selectedRow.displayAddress}</span>
            <span className="font-mono text-[10px] text-slate-500">
              Offset: +{selectedRow.address}
            </span>
          </div>

          <div className="mt-2 flex items-baseline justify-between">
            <span
              className={`text-2xl font-bold font-mono tracking-tight ${
                isCoil
                  ? selectedRow.rawValue
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                  : selectedRow.hasValue
                  ? 'text-amber-300'
                  : 'text-slate-500'
              }`}
            >
              {selectedRow.displayValue}
            </span>
            {selectedRow.unit && (
              <span className="text-sm font-semibold text-slate-400 ml-1 font-mono">
                {selectedRow.unit}
              </span>
            )}
          </div>

          <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-500">Raw Hex:</span>
            <span className="text-emerald-400 font-semibold">{selectedRow.rawHex}</span>
          </div>
          {selectedRow.lastUpdated && (
            <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>Cập nhật:</span>
              <span className="text-slate-400">{selectedRow.lastUpdated}</span>
            </div>
          )}
        </div>

        {/* Quick Write Action */}
        <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-300 text-[11px] flex items-center space-x-1">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ghi nhanh (Quick Write)</span>
            </span>
            {isReadOnly && (
              <span className="text-[10px] text-rose-400 bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-800/40">
                Bảng chỉ đọc
              </span>
            )}
          </div>

          {isCoil ? (
            <button
              disabled={isReadOnly}
              onClick={() => onToggleCoil(selectedRow.address, Boolean(selectedRow.rawValue))}
              className={`w-full py-1.5 rounded-md font-bold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-sm ${
                isReadOnly
                  ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                  : selectedRow.rawValue
                  ? 'bg-rose-600/30 text-rose-300 border border-rose-500/50 hover:bg-rose-600/40'
                  : 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-600/40'
              }`}
            >
              <span>Chuyển trạng thái sang: {selectedRow.rawValue ? 'OFF (0)' : 'ON (1)'}</span>
            </button>
          ) : (
            <form onSubmit={handleCommitWrite} className="flex space-x-1.5">
              <input
                type="text"
                disabled={isReadOnly}
                value={writeValue}
                onChange={(e) => setWriteValue(e.target.value)}
                placeholder="Nhập số thập phân hoặc 0x..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-amber-300 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500 disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={isReadOnly || !writeValue.trim()}
                className={`px-3 py-1 rounded font-semibold text-xs flex items-center space-x-1 transition-all ${
                  justCommitted
                    ? 'bg-emerald-600 text-white'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 disabled:hover:bg-cyan-600'
                }`}
              >
                {justCommitted ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                <span>Ghi</span>
              </button>
            </form>
          )}
        </div>

        {/* Configuration Fields */}
        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Tên biến (Alias)</label>
            <input
              type="text"
              value={selectedRow.alias}
              onChange={(e) => onUpdateAlias(selectedRow.address, e.target.value)}
              placeholder="VD: Điện áp pha A..."
              className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Đơn vị (Unit)</label>
              <input
                type="text"
                value={selectedRow.unit}
                onChange={(e) => onUpdateUnit(selectedRow.address, e.target.value)}
                placeholder="VD: V, A, kW..."
                className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
            {!isCoil && (
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Hệ số tỉ lệ (Scale)</label>
                <input
                  type="number"
                  step="any"
                  value={selectedRow.scaling}
                  onChange={(e) => onUpdateScaling(selectedRow.address, parseFloat(e.target.value) || 1)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}
          </div>

          {!isCoil && onUpdateFormat && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Định dạng giải mã riêng</label>
              <select
                value={selectedRow.format || ''}
                onChange={(e) => onUpdateFormat(selectedRow.address, e.target.value as DataFormat)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-xs text-indigo-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="">Theo cài đặt chung Sheet ({sheetFormat})</option>
                {formatOptions.map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Action Button: Trend Chart */}
        {onOpenChart && (
          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={() => onOpenChart(selectedRow)}
              className={`w-full py-1.5 rounded-md border text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                isTracing
                  ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/80'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <LineChart className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isTracing ? 'Đang vẽ trên biểu đồ (Click để bỏ)' : 'Thêm vào biểu đồ xu hướng'}</span>
            </button>
          </div>
        )}

        <div className="p-2 rounded bg-slate-900/40 border border-slate-800/80 text-[10px] text-slate-500 flex items-start space-x-1.5">
          <Info className="w-3.5 h-3.5 text-cyan-500 shrink-0 mt-0.5" />
          <span>Click đúp vào hàng bất kỳ trên bảng để mở cửa sổ ghi nâng cao (FC05/06/15/16).</span>
        </div>
      </div>
    </div>
  );
};
