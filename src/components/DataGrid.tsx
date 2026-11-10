import React, { useState, useMemo } from 'react';
import {
  SlidersHorizontal,
  LineChart,
  Search,
  X,
  LayoutGrid,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { DataFormat, RegisterRow } from '../types/modbus';

interface DataGridProps {
  rows: RegisterRow[];
  isCoil: boolean;
  sheetFormat?: DataFormat;
  selectedAddress?: number | null;
  onSelectRow?: (row: RegisterRow) => void;
  onRowDoubleClick: (row: RegisterRow) => void;
  onUpdateAlias: (address: number, alias: string) => void;
  onUpdateUnit: (address: number, unit: string) => void;
  onUpdateScaling: (address: number, scaling: number) => void;
  onUpdateFormat?: (address: number, format: DataFormat) => void;
  onInlineWrite: (address: number, valueStr: string) => void;
  onToggleCoil: (address: number, currentVal: boolean) => void;
  onToggleDisabledAddr?: (address: number, disabled: boolean) => void;
  onOpenChart?: (row: RegisterRow) => void;
  activeChartColorMap?: Record<number, string>;
}

const DataGridView: React.FC<DataGridProps> = ({
  rows,
  isCoil,
  sheetFormat = 'unsigned16',
  selectedAddress,
  onSelectRow,
  onRowDoubleClick,
  onUpdateAlias,
  onUpdateUnit,
  onUpdateScaling,
  onUpdateFormat,
  onInlineWrite,
  onToggleCoil,
  onToggleDisabledAddr,
  onOpenChart,
  activeChartColorMap,
}) => {
  // Inline edit state
  const [editingAddress, setEditingAddress] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<string>('');
  const [editInitial, setEditInitial] = useState<string>('');
  const [justWrittenAddress, setJustWrittenAddress] = useState<number | null>(null);

  // Address display mode: 'dec' | 'hex'
  const [addressMode, setAddressMode] = useState<'dec' | 'hex'>('dec');

  // Search / Filter state
  const [filterQuery, setFilterQuery] = useState<string>('');

  // Density mode: 'standard' | 'compact'
  const [density, setDensity] = useState<'standard' | 'compact'>('standard');

  // Multi-column live inspector mode
  const [isMultiColumnLive, setIsMultiColumnLive] = useState<boolean>(false);

  const startEdit = (row: RegisterRow) => {
    const initial = row.hasValue && row.displayValue !== '--' ? String(row.displayValue) : '';
    setEditingAddress(row.address);
    setEditInput(initial);
    setEditInitial(initial);
  };

  // Writes go to real devices, so only an explicit Enter with a changed value commits.
  const commitEdit = (address: number) => {
    if (editingAddress === address) {
      setEditingAddress(null);
      if (editInput.trim() === '' || editInput.trim() === editInitial.trim()) return;
      onInlineWrite(address, editInput);
      setJustWrittenAddress(address);
      setTimeout(() => setJustWrittenAddress(null), 1000);
    }
  };

  // Filter rows based on query (by address in dec/hex or alias)
  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hexStr = `0x${(r.address & 0xffff).toString(16).toLowerCase()}`;
      const hexRaw = (r.address & 0xffff).toString(16).toLowerCase();
      const matchAddr =
        r.address.toString().includes(q) ||
        r.displayAddress.toLowerCase().includes(q) ||
        hexStr.includes(q) ||
        hexRaw.includes(q);
      const matchAlias = r.alias.toLowerCase().includes(q);
      return matchAddr || matchAlias;
    });
  }, [rows, filterQuery]);

  const padY = density === 'compact' ? 'py-0.5' : 'py-1.5';
  const textClass = density === 'compact' ? 'text-[11px]' : 'text-xs';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 font-mono select-text">
      {/* --- DataGrid Top Sub-Toolbar --- */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs gap-2 shrink-0">
        {/* Left: Search filter bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Lọc địa chỉ hoặc tên biến..."
              className="pl-7 pr-6 py-1 bg-slate-950 border border-slate-700/80 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-48 sm:w-60 font-sans"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-1.5 text-slate-400 hover:text-white p-0.5"
                title="Xóa bộ lọc"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <span className="text-[11px] text-slate-400 font-sans">
            Hiển thị <strong className="text-white font-mono">{filteredRows.length}</strong> / {rows.length} hàng
          </span>
        </div>

        {/* Right: View mode controls */}
        <div className="flex items-center gap-1.5 font-sans">
          {/* Multi-Column Live Inspector Toggle */}
          {!isCoil && (
            <button
              onClick={() => setIsMultiColumnLive(!isMultiColumnLive)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold transition border ${
                isMultiColumnLive
                  ? 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-600/70 shadow-sm'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
              }`}
              title="Mở rộng bảng để giải mã đồng thời tất cả các định dạng (Int16, UInt16, Float ABCD/CDAB, BCD nước 48-bit) theo thời gian thực"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-fuchsia-400" />
              <span>{isMultiColumnLive ? 'Thu Gọn Đa Cột' : '⊞ Xem Đa Cột (Live)'}</span>
            </button>
          )}

          {/* Address Format Toggle: DEC vs HEX */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setAddressMode('dec')}
              className={`px-2 py-0.5 rounded transition ${
                addressMode === 'dec'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Hiển thị địa chỉ dạng Thập phân (Dec)"
            >
              DEC
            </button>
            <button
              type="button"
              onClick={() => setAddressMode('hex')}
              className={`px-2 py-0.5 rounded transition ${
                addressMode === 'hex'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Hiển thị địa chỉ dạng Thập lục phân (Hex 0x0000)"
            >
              HEX
            </button>
          </div>

          {/* Density Toggle */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => setDensity('standard')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                density === 'standard' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Khoảng cách dòng chuẩn"
            >
              Chuẩn
            </button>
            <button
              onClick={() => setDensity('compact')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                density === 'compact' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Khoảng cách dòng đậm đặc (xem được nhiều hàng hơn)"
            >
              Gọn
            </button>
          </div>
        </div>
      </div>

      {/* --- Main Table Viewport --- */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse border border-slate-800 text-left">
          {/* Table Header */}
          <thead className="sticky top-0 bg-slate-900 border-b border-slate-700 text-slate-300 font-semibold z-10 shadow-sm text-xs">
            <tr>
              <th
                className="px-2 py-2 border-r border-slate-800 w-12 text-center text-emerald-400"
                title="Tích chọn để Đọc, bỏ tích để Cấm Đọc (tự động tách khối lệnh né thanh ghi đó)"
              >
                Đọc
              </th>
              <th className="px-3 py-2 border-r border-slate-800 w-12 text-center text-slate-500">
                #
              </th>
              <th
                onClick={() => setAddressMode(addressMode === 'dec' ? 'hex' : 'dec')}
                className="px-3 py-2 border-r border-slate-800 w-28 text-cyan-400 cursor-pointer select-none hover:bg-slate-800 transition"
                title="Bấm để chuyển đổi hiển thị địa chỉ DEC / HEX"
              >
                <div className="flex items-center justify-between">
                  <span>Address</span>
                  <span className="text-[10px] px-1 py-0.2 rounded bg-slate-950 text-slate-300 border border-slate-700 font-mono font-normal">
                    {addressMode.toUpperCase()}
                  </span>
                </div>
              </th>
              <th className="px-3 py-2 border-r border-slate-800 w-24 text-slate-400">
                Offset
              </th>
              <th className="px-3 py-2 border-r border-slate-800 min-w-[160px] text-slate-200">
                Alias / Tên Biến
              </th>

              {/* Multi-Column Mode Headers vs Standard Header */}
              {isMultiColumnLive && !isCoil ? (
                <>
                  <th className="px-3 py-2 border-r border-slate-800 text-amber-400 bg-slate-900/90 min-w-[90px]">
                    Hex 16
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-emerald-400 bg-slate-900/90 min-w-[90px]">
                    UInt16
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-green-300 bg-slate-900/90 min-w-[90px]">
                    Int16
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-blue-400 bg-slate-900/90 min-w-[110px]">
                    Int32 (ABCD)
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-blue-300 bg-slate-900/90 min-w-[110px]">
                    Int32 (CDAB)
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-cyan-400 bg-slate-900/90 min-w-[120px]">
                    Float32 (ABCD)
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-cyan-300 bg-slate-900/90 min-w-[120px]">
                    Float32 (CDAB)
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-fuchsia-400 bg-slate-900/90 min-w-[130px]">
                    🌊 Nước 48 (BE)
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 text-pink-400 bg-slate-900/90 min-w-[130px]">
                    🌊 Nước BCD (12 số)
                  </th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2 border-r border-slate-800 min-w-[180px] text-amber-300 font-bold">
                    Value (Giá Trị) <span className="text-[10px] text-slate-400 font-normal font-sans">[Click để sửa & Enter]</span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-800 w-24 text-emerald-400">
                    Raw Hex
                  </th>
                  {!isCoil && (
                    <th className="px-3 py-2 border-r border-slate-800 w-32 text-indigo-400">
                      Giải mã (Format)
                    </th>
                  )}
                </>
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
                Cập Nhật
              </th>
              <th className="px-3 py-2 w-28 text-center text-slate-400">
                Thao Tác
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className={`divide-y divide-slate-800/80 ${textClass}`}>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={isMultiColumnLive ? 16 : 11} className="text-center py-16 text-slate-500 font-sans">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <SlidersHorizontal className="w-8 h-8 text-slate-600" />
                    <p className="text-sm font-medium">
                      {filterQuery ? 'Không tìm thấy thanh ghi phù hợp bộ lọc' : 'Chưa có dữ liệu thanh ghi'}
                    </p>
                    {filterQuery && (
                      <button
                        onClick={() => setFilterQuery('')}
                        className="text-xs text-cyan-400 hover:underline"
                      >
                        Xóa bộ lọc tìm kiếm
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const traceColor = activeChartColorMap?.[row.address];
                const isTracing = traceColor !== undefined;

                // Value flash direction color
                let flashBg = '';
                if (row.changed) {
                  if (row.changeDirection === 'up') {
                    flashBg = 'bg-emerald-500/20 text-emerald-200 transition-colors duration-500';
                  } else if (row.changeDirection === 'down') {
                    flashBg = 'bg-rose-500/20 text-rose-200 transition-colors duration-500';
                  } else {
                    flashBg = 'bg-cyan-500/20 text-cyan-200 transition-colors duration-500';
                  }
                }

                const isSelected = selectedAddress === row.address;
                const isRowDisabled = Boolean(row.disabled);

                return (
                  <tr
                    key={row.address}
                    onClick={() => onSelectRow && onSelectRow(row)}
                    onDoubleClick={() => onRowDoubleClick(row)}
                    className={`hover:bg-cyan-950/20 transition-colors group cursor-pointer ${
                      isRowDisabled ? 'opacity-50 bg-amber-950/10' : ''
                    } ${
                      isSelected
                        ? 'bg-cyan-950/40 ring-1 ring-inset ring-cyan-500/50'
                        : idx % 2 === 0
                        ? 'bg-slate-950'
                        : 'bg-slate-900/25'
                    }`}
                  >
                    {/* Read / Skip Toggle Checkbox */}
                    <td
                      className={`px-2 ${padY} border-r border-slate-800/80 text-center select-none`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={!isRowDisabled}
                        onChange={(e) => onToggleDisabledAddr && onToggleDisabledAddr(row.address, !e.target.checked)}
                        className="accent-emerald-400 cursor-pointer"
                        title={
                          isRowDisabled
                            ? `Địa chỉ ${row.address} đang bị Cấm Đọc (Né lỗi 0x02) — Nhấn để bật đọc lại`
                            : `Tích chọn: Đọc địa chỉ ${row.address} — Bỏ tích để Cấm Đọc (tự động tách khối lệnh)`
                        }
                      />
                    </td>

                    {/* Index & Trend Indicator */}
                    <td className={`px-2 ${padY} border-r border-slate-800/80 text-center select-none`}>
                      <div className="flex items-center justify-center space-x-1">
                        {isTracing && (
                          <span
                            className="w-2 h-2 rounded-full ring-2 ring-slate-900 shrink-0"
                            style={{ backgroundColor: traceColor || '#06b6d4' }}
                            title="Đang vẽ trên biểu đồ xu hướng"
                          />
                        )}
                        <span className="text-slate-600 text-[10px] font-mono">{idx + 1}</span>
                      </div>
                    </td>

                    {/* Modbus Address */}
                    <td className={`px-3 ${padY} border-r border-slate-800/80 font-bold font-mono`}>
                      {addressMode === 'hex' ? (
                        <span className="text-purple-400">
                          0x{(row.address & 0xffff).toString(16).toUpperCase().padStart(4, '0')}
                        </span>
                      ) : (
                        <span className="text-cyan-400">{row.displayAddress}</span>
                      )}
                    </td>

                    {/* Offset */}
                    <td className={`px-3 ${padY} border-r border-slate-800/80 text-slate-400 font-mono`}>
                      {addressMode === 'hex' ? (
                        <>+{idx} <span className="text-slate-500 text-[10px]">(0x{(row.address & 0xffff).toString(16).toUpperCase().padStart(4, '0')})</span></>
                      ) : (
                        <>+{idx} <span className="text-slate-500 text-[10px]">({row.address})</span></>
                      )}
                    </td>

                    {/* Editable Alias */}
                    <td className={`px-3 ${padY} border-r border-slate-800/80 font-sans text-slate-200`}>
                      <input
                        type="text"
                        value={row.alias}
                        placeholder="Đặt tên biến..."
                        onChange={(e) => onUpdateAlias(row.address, e.target.value)}
                        className="w-full bg-transparent text-slate-200 placeholder-slate-600 focus:outline-none focus:bg-slate-800 focus:px-1.5 focus:rounded border border-transparent focus:border-cyan-500 transition-all"
                      />
                    </td>

                    {/* Render Columns based on isMultiColumnLive */}
                    {isMultiColumnLive && !isCoil ? (
                      <>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-amber-400 font-bold`}>
                          {row.decodedMulti?.hex ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-emerald-400 font-semibold ${flashBg}`}>
                          {row.decodedMulti?.uint16 ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-green-300`}>
                          {row.decodedMulti?.int16 ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-blue-400`}>
                          {row.decodedMulti?.int32_abcd ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-blue-300`}>
                          {row.decodedMulti?.int32_cdab ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-cyan-400 font-bold`}>
                          {row.decodedMulti?.float_abcd ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-cyan-300`}>
                          {row.decodedMulti?.float_cdab ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-fuchsia-400 font-bold`}>
                          {row.decodedMulti?.water_48_be ?? '--'}
                        </td>
                        <td className={`px-3 ${padY} border-r border-slate-800/80 text-pink-400 font-bold`}>
                          {row.decodedMulti?.water_48_bcd ?? '--'}
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Standard Value with Flash Glow */}
                        <td
                          onClick={() => {
                            if (!isCoil && editingAddress !== row.address) {
                              startEdit(row);
                            }
                          }}
                          className={`px-4 ${padY} border-r border-slate-800/80 text-base font-bold tracking-wide transition-all select-none ${
                            isCoil
                              ? row.hasValue && row.rawValue
                                ? 'text-emerald-400 font-bold'
                                : 'text-slate-500'
                              : row.hasValue
                              ? 'text-amber-300'
                              : 'text-slate-500'
                          } ${flashBg} ${
                            justWrittenAddress === row.address ? 'bg-emerald-950/60 ring-1 ring-emerald-500' : ''
                          }`}
                          title={isCoil ? 'Nhấn để bật/tắt tiếp điểm' : 'Nhấn để nhập giá trị mới, bấm Enter để ghi'}
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
                                onBlur={() => setEditingAddress(null)}
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
                          ) : row.control?.type === 'readonly' ? (
                            /* READ-ONLY LOCKED REGISTER */
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-cyan-300">{row.displayValue}</span>
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-sans font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35"
                                title="Thanh ghi đang bật Cấm Ghi Mềm (Chỉ đọc)"
                              >
                                🔒 Chỉ đọc
                              </span>
                            </div>
                          ) : row.control?.type === 'buttons' && row.control.options ? (
                            /* MULTI-BUTTON MODE SELECTOR */
                            <div className="flex items-center justify-between gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                              <span className="font-mono font-bold text-amber-300 text-xs">{row.displayValue}</span>
                              <div className="flex items-center gap-1 flex-wrap">
                                {row.control.options.map((opt, i) => {
                                  const isAct = Number(row.rawValue) === Number(opt.value);
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => onInlineWrite(row.address, String(opt.value))}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                        isAct
                                          ? Number(opt.value) === 0
                                            ? 'bg-slate-700 text-white border-slate-400'
                                            : 'bg-emerald-500/25 text-emerald-200 border-emerald-400 shadow-sm'
                                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-cyan-300 hover:border-cyan-500/50'
                                      }`}
                                      title={`Ghi trạng thái ${opt.label} xuống địa chỉ ${row.address}`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : row.control?.type === 'stepper' ? (
                            /* 1. STEPPER CONTROLS (Up/Down Buttons) */
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  const cur = typeof row.rawValue === 'number' ? row.rawValue : parseFloat(row.displayValue) || 0;
                                  const step = row.control?.step ?? 1;
                                  let next = cur - step;
                                  if (row.control?.min !== undefined && next < row.control.min) next = row.control.min;
                                  onInlineWrite(row.address, String(next));
                                }}
                                title={`Giảm (-${row.control.step ?? 1})`}
                                className="p-1 rounded bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 border border-slate-700/80 transition"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <span
                                onClick={() => startEdit(row)}
                                className="font-bold font-mono text-amber-300 hover:underline cursor-pointer px-1 text-xs"
                                title="Click để gõ số trực tiếp"
                              >
                                {row.displayValue}
                              </span>
                              <button
                                onClick={() => {
                                  const cur = typeof row.rawValue === 'number' ? row.rawValue : parseFloat(row.displayValue) || 0;
                                  const step = row.control?.step ?? 1;
                                  let next = cur + step;
                                  if (row.control?.max !== undefined && next > row.control.max) next = row.control.max;
                                  onInlineWrite(row.address, String(next));
                                }}
                                title={`Tăng (+${row.control.step ?? 1})`}
                                className="p-1 rounded bg-slate-800 hover:bg-emerald-950/60 hover:text-emerald-300 text-slate-400 border border-slate-700/80 transition"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : row.control?.type === 'toggle' ? (
                            /* 2. HOLDING REGISTER DUAL ON/OFF TOGGLE BUTTONS */
                            (() => {
                              const onVal = row.control.onValue ?? 1;
                              const offVal = row.control.offValue ?? 0;
                              const isCurrentlyOn = Number(row.rawValue) === onVal;
                              const isCurrentlyOff = Number(row.rawValue) === offVal;
                              return (
                                <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="font-mono font-bold text-amber-300 text-xs">{row.displayValue}</span>
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      onClick={() => onInlineWrite(row.address, String(onVal))}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                        isCurrentlyOn
                                          ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/60 shadow-sm'
                                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-emerald-300'
                                      }`}
                                      title={`BẬT: Ghi ${onVal} xuống địa chỉ ${row.address}`}
                                    >
                                      🟢 BẬT
                                    </button>
                                    <button
                                      onClick={() => onInlineWrite(row.address, String(offVal))}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                        isCurrentlyOff
                                          ? 'bg-slate-700 text-slate-100 border-slate-400 shadow-sm'
                                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-rose-300'
                                      }`}
                                      title={`TẮT: Ghi ${offVal} xuống địa chỉ ${row.address}`}
                                    >
                                      ⚪ TẮT
                                    </button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : row.control?.type === 'dropdown' ? (
                            /* 3. DROPDOWN MENU */
                            <select
                              value={row.rawValue !== null ? String(row.rawValue) : ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                onInlineWrite(row.address, e.target.value);
                              }}
                              className="bg-slate-900 border border-cyan-500/60 text-cyan-300 text-xs rounded px-2 py-0.5 outline-none font-bold cursor-pointer hover:border-cyan-400"
                            >
                              {(row.control.options || []).map((opt, i) => (
                                <option key={i} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            /* 4. DEFAULT DISPLAY CELL */
                            <div className="flex items-center justify-between group/cell cursor-pointer">
                              {!row.hasValue ? (
                                <span className="text-slate-500 font-mono italic tracking-widest text-sm" title="Chưa đọc được dữ liệu hoặc đọc lỗi">
                                  --
                                </span>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span>{row.displayValue}</span>
                                  {/* Small direction trend indicator */}
                                  {row.changed && row.changeDirection === 'up' && (
                                    <span className="text-[10px] text-emerald-400 flex items-center font-normal">
                                      <ArrowUp className="w-3 h-3" />
                                    </span>
                                  )}
                                  {row.changed && row.changeDirection === 'down' && (
                                    <span className="text-[10px] text-rose-400 flex items-center font-normal">
                                      <ArrowDown className="w-3 h-3" />
                                    </span>
                                  )}
                                </div>
                              )}
                              <span className="opacity-0 group-hover/cell:opacity-100 text-[10px] text-cyan-400/80 font-sans font-normal ml-2 transition-opacity">
                                Sửa ↵
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Raw Hex */}
                        <td className={`px-3 ${padY} border-r border-slate-800/80 font-mono`}>
                          {row.hasValue ? (
                            <span className="text-emerald-400">{row.rawHex}</span>
                          ) : (
                            <span className="text-slate-600 font-mono">--</span>
                          )}
                        </td>

                        {/* Format Dropdown */}
                        {!isCoil && (
                          <td className={`px-2 ${padY} border-r border-slate-800/80`}>
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
                              <option value="water_48_be">🌊 Đồng Hồ Nước 48-bit (BE)</option>
                              <option value="water_48_le">🌊 Đồng Hồ Nước 48-bit (LE)</option>
                              <option value="water_48_bcd">🌊 Đồng Hồ Nước 48-bit BCD</option>
                              <option value="int64">Int 64 (4 Regs Signed)</option>
                              <option value="uint64">UInt 64 (4 Regs Unsigned)</option>
                              <option value="ascii">ASCII Text (2 Ký Tự)</option>
                            </select>
                          </td>
                        )}
                      </>
                    )}

                    {/* Unit */}
                    <td className={`px-3 ${padY} border-r border-slate-800/80 font-sans`}>
                      <input
                        type="text"
                        value={row.unit}
                        placeholder="-"
                        onChange={(e) => onUpdateUnit(row.address, e.target.value)}
                        className="w-16 bg-transparent text-slate-300 placeholder-slate-600 focus:outline-none focus:bg-slate-800 focus:px-1 focus:rounded border border-transparent focus:border-cyan-500 text-center"
                      />
                    </td>

                    {/* Scaling */}
                    {!isCoil && (
                      <td className={`px-3 ${padY} border-r border-slate-800/80 font-sans text-slate-400`}>
                        <input
                          type="number"
                          step="any"
                          value={row.scaling}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            onUpdateScaling(row.address, isNaN(val) ? 1 : val);
                          }}
                          className="w-16 bg-transparent text-slate-400 focus:text-slate-200 focus:outline-none focus:bg-slate-800 focus:px-1 focus:rounded border border-transparent focus:border-cyan-500 text-center font-mono"
                        />
                      </td>
                    )}

                    {/* Last Updated */}
                    <td className={`px-3 ${padY} border-r border-slate-800/80 text-[11px] font-mono text-slate-400 whitespace-nowrap`}>
                      {row.lastUpdated ? (
                        <span className="text-slate-300">{row.lastUpdated}</span>
                      ) : (
                        <span className="text-slate-600">--</span>
                      )}
                    </td>

                    {/* Action buttons (Chart Trace & Edit) */}
                    <td className={`px-3 ${padY} text-center select-none`}>
                      <div className="flex items-center justify-center space-x-1">
                        {onOpenChart && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenChart(row);
                            }}
                            className={`p-1 rounded transition-colors ${
                              isTracing
                                ? 'bg-cyan-950 text-cyan-300 ring-1 ring-cyan-500'
                                : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'
                            }`}
                            title={isTracing ? 'Bỏ theo dõi khỏi Biểu đồ xu hướng' : 'Theo dõi biến này trên Biểu đồ xu hướng'}
                          >
                            <LineChart className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => onRowDoubleClick(row)}
                          className="text-slate-500 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
                          title="Mở hộp thoại ghi chi tiết (Write Register / Coil)"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Memoized: App re-renders on every poll of any tab and on chart hover, but a grid only needs to
// re-render when its own rows or props change (App passes stable callbacks per tab).
export const DataGrid = React.memo(DataGridView);
