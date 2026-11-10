import React, { useState } from 'react';
import {
  X,
  Sliders,
  LineChart,
  Check,
  Send,
  Zap,
  Info,
  ChevronUp,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  ControlWidgetType,
  DataFormat,
  RegisterControlConfig,
  RegisterRow,
} from '../types/modbus';

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
  onUpdateControl?: (address: number, control: RegisterControlConfig) => void;
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
  onUpdateControl,
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

          {/* Control Widget Configuration & Quick Actions */}
          {!isCoil && onUpdateControl && (
            <div className="p-3 rounded-lg border border-cyan-800/40 bg-slate-900/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-300 text-[11px] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Nút điều khiển nhanh (Control Widget)</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {selectedRow.control?.type || 'none'}
                </span>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Loại điều khiển ô</label>
                <select
                  value={selectedRow.control?.type || 'none'}
                  onChange={(e) => {
                    const t = e.target.value as ControlWidgetType;
                    if (t === 'none') {
                      onUpdateControl(selectedRow.address, { type: 'none' });
                    } else if (t === 'stepper') {
                      onUpdateControl(selectedRow.address, {
                        type: 'stepper',
                        step: selectedRow.control?.step ?? 1,
                        min: selectedRow.control?.min,
                        max: selectedRow.control?.max,
                      });
                    } else if (t === 'toggle') {
                      onUpdateControl(selectedRow.address, {
                        type: 'toggle',
                        onValue: selectedRow.control?.onValue ?? 1,
                        offValue: selectedRow.control?.offValue ?? 0,
                      });
                    } else if (t === 'dropdown') {
                      onUpdateControl(selectedRow.address, {
                        type: 'dropdown',
                        options: selectedRow.control?.options && selectedRow.control.options.length > 0
                          ? selectedRow.control.options
                          : [
                              { label: '0: Dừng (STOP)', value: 0 },
                              { label: '1: Chạy thuận (RUN FWD)', value: 1 },
                              { label: '2: Chạy ngược (RUN REV)', value: 2 },
                            ],
                      });
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-cyan-300 focus:outline-none focus:border-cyan-400 font-semibold"
                >
                  <option value="none">-- Mặc định (Chỉ nhập số thường) --</option>
                  <option value="stepper">▲/▼ Mũi tên Lên/Xuống (Stepper +/-)</option>
                  <option value="toggle">⏻ Công tắc Bật/Tắt (Toggle ON/OFF)</option>
                  <option value="dropdown">▼ Danh sách xổ chọn (Dropdown Menu)</option>
                </select>
              </div>

              {/* Stepper Options & Live Buttons */}
              {selectedRow.control?.type === 'stepper' && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="block text-[10px] text-slate-400">Bước (Step)</label>
                      <input
                        type="number"
                        step="any"
                        value={selectedRow.control.step ?? 1}
                        onChange={(e) =>
                          onUpdateControl(selectedRow.address, {
                            ...selectedRow.control!,
                            step: parseFloat(e.target.value) || 1,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-amber-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Min</label>
                      <input
                        type="number"
                        value={selectedRow.control.min ?? ''}
                        placeholder="Không"
                        onChange={(e) =>
                          onUpdateControl(selectedRow.address, {
                            ...selectedRow.control!,
                            min: e.target.value === '' ? undefined : parseFloat(e.target.value),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Max</label>
                      <input
                        type="number"
                        value={selectedRow.control.max ?? ''}
                        placeholder="Không"
                        onChange={(e) =>
                          onUpdateControl(selectedRow.address, {
                            ...selectedRow.control!,
                            max: e.target.value === '' ? undefined : parseFloat(e.target.value),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-300 font-mono"
                      />
                    </div>
                  </div>

                  {/* Live Test Stepper Buttons */}
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={isReadOnly}
                      onClick={() => {
                        const cur = typeof selectedRow.rawValue === 'number' ? selectedRow.rawValue : parseFloat(selectedRow.displayValue) || 0;
                        const step = selectedRow.control?.step ?? 1;
                        let next = cur - step;
                        if (selectedRow.control?.min !== undefined && next < selectedRow.control.min) next = selectedRow.control.min;
                        onInlineWrite(selectedRow.address, String(next));
                      }}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded font-bold flex items-center justify-center gap-1 transition text-xs"
                    >
                      <ChevronDown className="w-3.5 h-3.5 text-rose-400" />
                      <span>Giảm (-{selectedRow.control.step ?? 1})</span>
                    </button>
                    <button
                      disabled={isReadOnly}
                      onClick={() => {
                        const cur = typeof selectedRow.rawValue === 'number' ? selectedRow.rawValue : parseFloat(selectedRow.displayValue) || 0;
                        const step = selectedRow.control?.step ?? 1;
                        let next = cur + step;
                        if (selectedRow.control?.max !== undefined && next > selectedRow.control.max) next = selectedRow.control.max;
                        onInlineWrite(selectedRow.address, String(next));
                      }}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded font-bold flex items-center justify-center gap-1 transition text-xs"
                    >
                      <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Tăng (+{selectedRow.control.step ?? 1})</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Toggle Options & Live Button */}
              {selectedRow.control?.type === 'toggle' && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">Giá trị khi BẬT (ON)</label>
                      <input
                        type="number"
                        value={selectedRow.control.onValue ?? 1}
                        onChange={(e) =>
                          onUpdateControl(selectedRow.address, {
                            ...selectedRow.control!,
                            onValue: parseInt(e.target.value) || 1,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-emerald-400 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Giá trị khi TẮT (OFF)</label>
                      <input
                        type="number"
                        value={selectedRow.control.offValue ?? 0}
                        onChange={(e) =>
                          onUpdateControl(selectedRow.address, {
                            ...selectedRow.control!,
                            offValue: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-rose-400 font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Live Test Toggle Button */}
                  {(() => {
                    const onVal = selectedRow.control?.onValue ?? 1;
                    const offVal = selectedRow.control?.offValue ?? 0;
                    const isCurrentlyOn = Number(selectedRow.rawValue) === onVal;
                    return (
                      <button
                        disabled={isReadOnly}
                        onClick={() => onInlineWrite(selectedRow.address, String(isCurrentlyOn ? offVal : onVal))}
                        className={`w-full py-2 rounded font-bold text-xs flex items-center justify-center gap-2 transition shadow-sm ${
                          isCurrentlyOn
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500 hover:bg-emerald-600/40'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {isCurrentlyOn ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4 text-slate-500" />}
                        <span>Đang {isCurrentlyOn ? 'BẬT' : 'TẮT'} — Click để đổi sang: {isCurrentlyOn ? `${offVal} (OFF)` : `${onVal} (ON)`}</span>
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* Dropdown Options & Live Selector */}
              {selectedRow.control?.type === 'dropdown' && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <label className="block text-[10px] text-slate-400">Thao tác trực tiếp (Live Select)</label>
                  <select
                    disabled={isReadOnly}
                    value={selectedRow.rawValue !== null ? String(selectedRow.rawValue) : ''}
                    onChange={(e) => onInlineWrite(selectedRow.address, e.target.value)}
                    className="w-full bg-slate-950 border border-cyan-500 text-cyan-300 rounded px-2.5 py-1 text-xs font-bold cursor-pointer"
                  >
                    {(selectedRow.control.options || []).map((opt, i) => (
                      <option key={i} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
