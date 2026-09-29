import React, { useState } from 'react';
import { SlidersHorizontal, LineChart } from 'lucide-react';
import { DataFormat, RegisterRow } from '../types/modbus';

interface DataGridProps {
  rows: RegisterRow[];
  isCoil: boolean;
  sheetFormat?: DataFormat;
  onRowDoubleClick: (row: RegisterRow) => void;
  onUpdateAlias: (address: number, alias: string) => void;
  onUpdateUnit: (address: number, unit: string) => void;
  onUpdateScaling: (address: number, scaling: number) => void;
  onUpdateFormat?: (address: number, format: DataFormat) => void;
  onInlineWrite: (address: number, valueStr: string) => void;
  onToggleCoil: (address: number, currentVal: boolean) => void;
  onOpenChart?: (row: RegisterRow) => void;
  activeChartAddresses?: number[];
  activeChartColorMap?: Record<number, string>;
}

export const DataGrid: React.FC<DataGridProps> = ({
  rows,
  isCoil,
  sheetFormat = 'unsigned16',
  onRowDoubleClick,
  onUpdateAlias,
  onUpdateUnit,
  onUpdateScaling,
  onUpdateFormat,
  onInlineWrite,
  onToggleCoil,
  onOpenChart,
  activeChartAddresses,
  activeChartColorMap,
}) => {
  // Inline edit state
  const [editingAddress, setEditingAddress] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<string>('');
  const [justWrittenAddress, setJustWrittenAddress] = useState<number | null>(null);

  const startEdit = (row: RegisterRow) => {
    setEditingAddress(row.address);
    setEditInput(row.displayValue !== '--' ? String(row.displayValue) : '0');
  };

  const commitEdit = (address: number) => {
    if (editingAddress === address) {
      onInlineWrite(address, editInput);
      setEditingAddress(null);
      setJustWrittenAddress(address);
      setTimeout(() => setJustWrittenAddress(null), 1000);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-950 font-mono text-xs select-text">
      <table className="w-full border-collapse border border-slate-800 text-left">
        {/* Table Header */}
        <thead className="sticky top-0 bg-slate-900 border-b border-slate-700 text-slate-300 font-semibold z-10 shadow-sm">
          <tr>
            <th className="px-3 py-2 border-r border-slate-800 w-12 text-center text-slate-500">
              #
            </th>
            <th className="px-3 py-2 border-r border-slate-800 w-24 text-cyan-400">
              Address
            </th>
            <th className="px-3 py-2 border-r border-slate-800 w-20 text-slate-400">
              Offset
            </th>
            <th className="px-3 py-2 border-r border-slate-800 min-w-[180px] text-slate-200">
              Alias / Tên Biến
            </th>
            <th className="px-4 py-2 border-r border-slate-800 min-w-[180px] text-amber-300 font-bold">
              Value (Giá Trị) <span className="text-[10px] text-slate-400 font-normal">[Click để gõ & Enter]</span>
            </th>
            <th className="px-3 py-2 border-r border-slate-800 w-24 text-emerald-400">
              Raw Hex
            </th>
            {!isCoil && (
              <th className="px-3 py-2 border-r border-slate-800 w-32 text-indigo-400">
                Giải mã (Format)
              </th>
            )}
            <th className="px-3 py-2 border-r border-slate-800 w-20 text-slate-300">
              Đơn Vị
            </th>
            {!isCoil && (
              <th className="px-3 py-2 border-r border-slate-800 w-20 text-slate-400">
                Scale
              </th>
            )}
            <th className="px-3 py-2 border-r border-slate-800 w-28 text-slate-400">
              Cập Nhật (Time)
            </th>
            <th className="px-3 py-2 w-32 text-center text-slate-400">
              Thao Tác
            </th>
          </tr>
        </thead>

        {/* Table Body */}
        <tbody className="divide-y divide-slate-800/80">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="text-center py-16 text-slate-500 font-sans">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <SlidersHorizontal className="w-8 h-8 text-slate-600" />
                  <p className="text-sm font-medium">Chưa có dữ liệu thanh ghi</p>
                  <p className="text-xs text-slate-500">
                    Nhấn <span className="text-cyan-400">Connect (F3)</span> và <span className="text-emerald-400">Poll</span> để bắt đầu quét
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const traceColor = activeChartColorMap?.[row.address];
              const isChartActive = Boolean(traceColor) || (activeChartAddresses && activeChartAddresses.includes(row.address));

              return (
                <tr
                  key={row.address}
                  className={`hover:bg-slate-800/60 transition-colors group ${
                    isChartActive
                      ? 'bg-slate-900/90 border-l-2'
                      : row.changed
                      ? 'bg-cyan-950/20'
                      : idx % 2 === 0
                      ? 'bg-slate-950'
                      : 'bg-slate-900/30'
                  }`}
                  style={isChartActive && traceColor ? { borderLeftColor: traceColor } : undefined}
                >
                  {/* Index */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 text-center text-slate-500 select-none">
                    {idx + 1}
                  </td>

                  {/* Modbus Address */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 text-cyan-400 font-bold">
                    {row.displayAddress}
                  </td>

                  {/* Offset */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 text-slate-400">
                    +{idx} ({row.address})
                  </td>

                  {/* Editable Alias */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 font-sans text-slate-200">
                    <input
                      type="text"
                      value={row.alias}
                      placeholder="Đặt tên biến..."
                      onChange={(e) => onUpdateAlias(row.address, e.target.value)}
                      className="w-full bg-transparent text-slate-200 placeholder-slate-600 focus:outline-none focus:bg-slate-800 focus:px-1.5 focus:rounded border border-transparent focus:border-cyan-500 transition-all"
                    />
                  </td>

                  {/* Value (Flash highlight on update & inline editable) */}
                  <td
                    onClick={() => {
                      if (editingAddress !== row.address) {
                        startEdit(row);
                      }
                    }}
                    className={`px-4 py-1.5 border-r border-slate-800/80 text-base font-bold tracking-wide transition-all select-none ${
                      isCoil
                        ? row.hasValue && row.rawValue
                          ? 'text-emerald-400 font-bold'
                          : 'text-slate-500'
                        : row.hasValue
                        ? 'text-amber-300'
                        : 'text-slate-500'
                    } ${row.changed ? 'flash-update' : ''} ${
                      justWrittenAddress === row.address ? 'bg-emerald-950/60 ring-1 ring-emerald-500' : ''
                    }`}
                    title={isCoil ? "Nhấn để bật/tắt (Toggle)" : "Nhấn để nhập giá trị mới, bấm Enter để ghi"}
                  >
                    {editingAddress === row.address ? (
                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          autoFocus
                          value={editInput}
                          onChange={(e) => setEditInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitEdit(row.address);
                            } else if (e.key === 'Escape') {
                              setEditingAddress(null);
                            }
                          }}
                          onBlur={() => commitEdit(row.address)}
                          className="w-full bg-slate-900 text-amber-300 font-mono font-bold px-2 py-0.5 rounded border border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 text-sm shadow-inner"
                          placeholder="Nhập giá trị..."
                        />
                        <span className="text-[10px] text-cyan-400 font-sans font-normal shrink-0">Enter ↵</span>
                      </div>
                    ) : isCoil ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleCoil(row.address, Boolean(row.rawValue));
                        }}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs transition-all ${
                          !row.hasValue
                            ? 'bg-slate-900 text-slate-500 border border-slate-800'
                            : row.rawValue
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {!row.hasValue ? '--' : row.rawValue ? 'ON (1)' : 'OFF (0)'}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between group/cell cursor-pointer">
                        {!row.hasValue ? (
                          <span className="text-slate-500 font-mono italic tracking-widest text-sm" title="Chưa đọc được dữ liệu hoặc đọc lỗi">
                            --
                          </span>
                        ) : (
                          <span>{row.displayValue}</span>
                        )}
                        <span className="opacity-0 group-hover/cell:opacity-100 text-[10px] text-cyan-400/80 font-sans font-normal ml-2 transition-opacity">
                          Sửa ↵
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Raw Hex */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 font-mono">
                    {row.hasValue ? (
                      <span className="text-emerald-400">{row.rawHex}</span>
                    ) : (
                      <span className="text-slate-600 font-mono">--</span>
                    )}
                  </td>

                  {/* Per-register Data Format Selector */}
                  {!isCoil && (
                    <td className="px-2 py-1.5 border-r border-slate-800/80">
                      <select
                        value={row.format || ''}
                        onChange={(e) => onUpdateFormat && onUpdateFormat(row.address, e.target.value as DataFormat)}
                        className="w-full bg-slate-900/80 border border-slate-800 rounded px-1.5 py-0.5 text-indigo-300 text-[11px] focus:outline-none focus:border-cyan-500 font-sans cursor-pointer hover:border-slate-700"
                        title="Định dạng giải mã riêng cho thanh ghi này"
                      >
                        <option value="">Theo Sheet ({sheetFormat})</option>
                        <option value="unsigned16">Unsigned 16-bit (0..65535)</option>
                        <option value="signed16">Signed 16-bit (-32768..32767)</option>
                        <option value="hex16">Hex (0x...)</option>
                        <option value="bin16">Binary (16-bit)</option>
                        <option value="float_abcd">Float 32 (ABCD - Big Endian)</option>
                        <option value="float_cdab">Float 32 (CDAB - Word Swap)</option>
                        <option value="float_badc">Float 32 (BADC - Byte Swap)</option>
                        <option value="float_dcba">Float 32 (DCBA - Little Endian)</option>
                        <option value="long_abcd">Int 32 (ABCD Signed)</option>
                        <option value="long_cdab">Int 32 (CDAB Signed)</option>
                        <option value="uint32_abcd">UInt 32 (ABCD Unsigned)</option>
                        <option value="uint32_cdab">UInt 32 (CDAB Unsigned)</option>
                        <option value="water_48_be">🌊 Đồng Hồ Nước 48-bit (Big-Endian 3 Regs)</option>
                        <option value="water_48_le">🌊 Đồng Hồ Nước 48-bit (Little-Endian 3 Regs)</option>
                        <option value="water_48_bcd">🌊 Đồng Hồ Nước 48-bit BCD (12 Chữ Số)</option>
                        <option value="int64">Int 64 (4 Regs Signed)</option>
                        <option value="uint64">UInt 64 (4 Regs Unsigned)</option>
                        <option value="ascii">ASCII Text (2 Ký Tự)</option>
                      </select>

                    </td>
                  )}

                  {/* Unit */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 font-sans">
                    <input
                      type="text"
                      value={row.unit}
                      placeholder="-"
                      onChange={(e) => onUpdateUnit(row.address, e.target.value)}
                      className="w-16 bg-transparent text-slate-300 placeholder-slate-600 focus:outline-none focus:bg-slate-800 focus:px-1 focus:rounded border border-transparent focus:border-cyan-500 text-center"
                    />
                  </td>

                  {/* Scaling factor */}
                  {!isCoil && (
                    <td className="px-3 py-1.5 border-r border-slate-800/80 font-sans text-slate-400">
                      <input
                        type="number"
                        step="any"
                        value={row.scaling}
                        onChange={(e) => onUpdateScaling(row.address, parseFloat(e.target.value) || 1)}
                        className="w-16 bg-transparent text-slate-300 focus:outline-none focus:bg-slate-800 focus:px-1 focus:rounded border border-transparent focus:border-cyan-500 text-center"
                      />
                    </td>
                  )}

                  {/* Last Updated Timestamp */}
                  <td className="px-3 py-1.5 border-r border-slate-800/80 text-[11px] text-slate-500 font-mono">
                    {row.lastUpdated ? (
                      <span className={row.hasValue ? 'text-slate-400' : 'text-slate-600 italic'}>
                        {row.lastUpdated}
                      </span>
                    ) : (
                      '--'
                    )}
                  </td>

                  {/* Actions: Trend Chart & Write Dialog */}
                  <td className="px-2 py-1.5 text-center flex items-center justify-center space-x-1">
                    {/* Open / Toggle Realtime Trend Chart */}
                    {onOpenChart && !isCoil && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChart(row);
                        }}
                        className={`p-1 rounded transition-all shadow-sm ${
                          isChartActive
                            ? 'text-white ring-1 ring-white/30'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300'
                        }`}
                        style={isChartActive ? { backgroundColor: traceColor || '#0891b2' } : undefined}
                        title={
                          isChartActive
                            ? "Đang vẽ trên biểu đồ xu hướng. Nhấp để bỏ theo dõi"
                            : "Thêm vào biểu đồ xu hướng thời gian thực đa kênh"
                        }
                      >
                        <LineChart className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Advanced Write Modal */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRowDoubleClick(row);
                      }}
                      className="px-2 py-0.5 text-[11px] rounded bg-slate-800 hover:bg-cyan-600 text-slate-300 hover:text-white border border-slate-700 hover:border-cyan-500 transition-all font-sans"
                      title="Mở hộp thoại ghi nâng cao"
                    >
                      Write...
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
