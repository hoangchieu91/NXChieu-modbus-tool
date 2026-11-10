import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  Trash2,
  TrendingUp,
  Maximize2,
  Minimize2,
  Download,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Radio,
  Sliders,
  Plus,
  LineChart,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  LayoutGrid,
} from 'lucide-react';
import { ChartDataPoint, ChartTrace, RegisterRow } from '../types/modbus';
import { decodeRegisterStateBadge } from '../utils/rowBuilder';

interface TrendChartProps {
  traces: ChartTrace[];
  traceData: Record<string, ChartDataPoint[]>;
  onToggleTraceVisibility: (traceId: string) => void;
  onRemoveTrace: (traceId: string) => void;
  onMoveTrace?: (traceId: string, delta: number) => void;
  onToggleTraceSpan?: (traceId: string) => void;
  onRenameTrace?: (trace: ChartTrace, newLabel: string) => void;
  onInlineWrite?: (address: number, newValStr: string) => void;
  onToggleCoil?: (address: number, currentVal: boolean) => void;
  isCoil?: boolean;
  onClear: () => void;
  onClose: () => void;
  isFullScreen?: boolean;
  availableRows?: RegisterRow[];
  onAddTrace?: (row: RegisterRow) => void;
}

export const TrendChart: React.FC<TrendChartProps> = ({
  traces,
  traceData,
  onToggleTraceVisibility,
  onRemoveTrace,
  onMoveTrace,
  onToggleTraceSpan,
  onRenameTrace,
  onInlineWrite,
  onToggleCoil,
  isCoil = false,
  onClear,
  onClose,
  isFullScreen = false,
  availableRows,
  onAddTrace,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Display mode
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isNormalizedScale, setIsNormalizedScale] = useState<boolean>(false);
  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [displayLayout, setDisplayLayout] = useState<'both' | 'cards' | 'chart'>('both');
  const [gridCols, setGridCols] = useState<'auto' | '2' | '3' | '4'>('auto');

  const rowByAddress = useMemo(() => {
    const map = new Map<number, RegisterRow>();
    (availableRows || []).forEach((r) => map.set(r.address, r));
    return map;
  }, [availableRows]);


  // Zoom & Pan state
  const [viewPointsCount, setViewPointsCount] = useState<number>(60); // number of points shown in window
  const [panOffset, setPanOffset] = useState<number>(0); // 0 = latest (auto-follow realtime)
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartOffset, setDragStartOffset] = useState<number>(0);

  // Mouse Inspection Crosshair
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    timestamp: string;
    points: { label: string; value: number; unit: string; color: string }[];
  } | null>(null);

  // Frozen data snapshot when paused
  const [frozenData, setFrozenData] = useState<Record<string, ChartDataPoint[]>>({});
  useEffect(() => {
    if (!isPaused) {
      setFrozenData(traceData);
    }
  }, [traceData, isPaused]);

  const activeData = isPaused ? frozenData : traceData;
  const visibleTraces = useMemo(() => traces.filter((t) => t.visible), [traces]);

  // Determine common timestamps or max points length
  const maxAvailablePoints = useMemo(() => {
    let maxLen = 0;
    traces.forEach((t) => {
      const pts = activeData[t.id] || [];
      if (pts.length > maxLen) maxLen = pts.length;
    });
    return maxLen;
  }, [traces, activeData]);

  // Compute overall min, max across all visible traces in current view window
  const windowSliceRange = useMemo(() => {
    if (maxAvailablePoints === 0) return { startIdx: 0, endIdx: 0 };
    const end = Math.max(0, maxAvailablePoints - panOffset);
    const start = Math.max(0, end - viewPointsCount);
    return { startIdx: start, endIdx: end };
  }, [maxAvailablePoints, panOffset, viewPointsCount]);

  // Traces are right-aligned: the newest point of every trace sits at the right edge, so a trace
  // added later (fewer points) is still visible and stays aligned in time with the others.
  const sliceWindow = useCallback(
    (pts: ChartDataPoint[]) => {
      const offset = maxAvailablePoints - pts.length;
      const from = Math.max(0, windowSliceRange.startIdx - offset);
      const to = Math.max(0, windowSliceRange.endIdx - offset);
      return { pts: pts.slice(from, to), firstGlobalIdx: from + offset };
    },
    [maxAvailablePoints, windowSliceRange]
  );

  // Compute Stats for each trace in current window
  const traceStats = useMemo(() => {
    const stats: Record<string, { current: number; min: number; max: number; avg: number }> = {};

    traces.forEach((t) => {
      const windowPts = sliceWindow(activeData[t.id] || []).pts;
      if (windowPts.length === 0) {
        stats[t.id] = { current: 0, min: 0, max: 0, avg: 0 };
      } else {
        const vals = windowPts.map((p) => p.value);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const sum = vals.reduce((a, b) => a + b, 0);
        const current = windowPts[windowPts.length - 1].value;
        stats[t.id] = { current, min, max, avg: sum / vals.length };
      }
    });

    return stats;
  }, [traces, activeData, sliceWindow]);

  // Overall Global Min/Max for chart Y-axis
  const globalYRange = useMemo(() => {
    let globalMin = Infinity;
    let globalMax = -Infinity;

    visibleTraces.forEach((t) => {
      const windowPts = sliceWindow(activeData[t.id] || []).pts;
      windowPts.forEach((p) => {
        if (p.value < globalMin) globalMin = p.value;
        if (p.value > globalMax) globalMax = p.value;
      });
    });

    if (globalMin === Infinity || globalMax === -Infinity) {
      return { min: 0, max: 100, range: 100 };
    }

    if (globalMin === globalMax) {
      globalMin -= 1;
      globalMax += 1;
    } else {
      const margin = (globalMax - globalMin) * 0.15;
      globalMin -= margin;
      globalMax += margin;
    }

    return { min: globalMin, max: globalMax, range: globalMax - globalMin };
  }, [visibleTraces, activeData, sliceWindow]);

  // Main Canvas Render
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    // Reallocate the backing store only when the size changes; resetting it every frame is costly.
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const padding = { top: 20, right: 60, bottom: 26, left: 20 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (visibleTraces.length === 0 || maxAvailablePoints === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        visibleTraces.length === 0
          ? 'Chưa chọn đường tín hiệu nào (Vui lòng bật hiển thị ít nhất 1 biến)'
          : 'Đang chờ dữ liệu gửi về từ Modbus Master/Slave...',
        width / 2,
        height / 2
      );
      return;
    }

    // 1. Draw Grid Lines (Horizontal)
    ctx.strokeStyle = '#1e293b'; // slate-800
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = padding.top + (chartH / gridSteps) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      const gridLabel = isNormalizedScale
        ? `${100 - Math.round((100 / gridSteps) * i)}%`
        : (globalYRange.max - (globalYRange.range / gridSteps) * i).toFixed(2);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(gridLabel, padding.left + chartW + 6, y + 3);
    }
    ctx.setLineDash([]);

    // 2. Draw Each Visible Trace
    const totalPointsInWindow = windowSliceRange.endIdx - windowSliceRange.startIdx;
    const xStep = totalPointsInWindow > 1 ? chartW / (totalPointsInWindow - 1) : chartW;

    visibleTraces.forEach((trace) => {
      const { pts: windowPts, firstGlobalIdx } = sliceWindow(activeData[trace.id] || []);
      if (windowPts.length === 0) return;
      const xOffset = firstGlobalIdx - windowSliceRange.startIdx;

      // Calculate trace-specific range if Normalized Mode is active
      let traceMin = globalYRange.min;
      let traceRange = globalYRange.range;
      if (isNormalizedScale) {
        const vals = windowPts.map((p) => p.value);
        let vMin = Math.min(...vals);
        let vMax = Math.max(...vals);
        if (vMin === vMax) {
          vMin -= 1;
          vMax += 1;
        }
        const margin = (vMax - vMin) * 0.12;
        traceMin = vMin - margin;
        traceRange = (vMax - vMin) + margin * 2;
      }

      const coords: { x: number; y: number; val: number; time: string }[] = [];
      windowPts.forEach((p, idx) => {
        const x = padding.left + (xOffset + idx) * xStep;
        const normalizedY = (p.value - traceMin) / traceRange;
        const y = padding.top + chartH - normalizedY * chartH;
        coords.push({ x, y, val: p.value, time: p.timestamp });
      });


      if (coords.length > 0) {
        // Gradient fill below first visible trace if single, or light transparent fill
        if (visibleTraces.length === 1) {
          const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
          grad.addColorStop(0, `${trace.color}40`);
          grad.addColorStop(1, `${trace.color}00`);

          ctx.beginPath();
          ctx.moveTo(coords[0].x, padding.top + chartH);
          coords.forEach((pt) => ctx.lineTo(pt.x, pt.y));
          ctx.lineTo(coords[coords.length - 1].x, padding.top + chartH);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Draw Spline
        ctx.strokeStyle = trace.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = `${trace.color}80`;
        ctx.shadowBlur = 6;

        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length; i++) {
          const xc = (coords[i].x + coords[i - 1].x) / 2;
          const yc = (coords[i].y + coords[i - 1].y) / 2;
          ctx.quadraticCurveTo(coords[i - 1].x, coords[i - 1].y, xc, yc);
        }
        if (coords.length > 1) {
          const last = coords[coords.length - 1];
          ctx.lineTo(last.x, last.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw Points
        if (totalPointsInWindow < 50) {
          coords.forEach((pt, i) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, i === coords.length - 1 ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = trace.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        } else {
          // Only last point
          const last = coords[coords.length - 1];
          ctx.beginPath();
          ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = trace.color;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    });

    // 3. Draw Inspection Crosshair if active
    if (hoverInfo) {
      ctx.strokeStyle = '#94a3b8'; // slate-400
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(hoverInfo.x, padding.top);
      ctx.lineTo(hoverInfo.x, padding.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Timestamp label at bottom of crosshair
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(hoverInfo.x - 40, padding.top + chartH + 3, 80, 18);
      ctx.strokeStyle = '#334155';
      ctx.strokeRect(hoverInfo.x - 40, padding.top + chartH + 3, 80, 18);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hoverInfo.timestamp, hoverInfo.x, padding.top + chartH + 16);
    }
  }, [activeData, visibleTraces, maxAvailablePoints, windowSliceRange, sliceWindow, globalYRange, hoverInfo, isNormalizedScale]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // Redraw when the canvas is resized (window resize, expand/collapse, split view).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => drawChart());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawChart]);

  // Handle Mouse Hover / Crosshair on Canvas
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDragging) {
      const deltaX = mouseX - dragStartX;
      const pointsShift = Math.round((deltaX / (rect.width - 80)) * viewPointsCount);
      const newOffset = Math.max(0, Math.min(maxAvailablePoints - viewPointsCount, dragStartOffset + pointsShift));
      setPanOffset(newOffset);
      return;
    }

    const padding = { top: 20, right: 60, bottom: 26, left: 20 };
    const chartW = rect.width - padding.left - padding.right;

    if (mouseX < padding.left || mouseX > padding.left + chartW) {
      setHoverInfo(null);
      return;
    }

    const totalPointsInWindow = windowSliceRange.endIdx - windowSliceRange.startIdx;
    if (totalPointsInWindow <= 0) {
      setHoverInfo(null);
      return;
    }

    const relX = mouseX - padding.left;
    const pointIdxInWindow = Math.round((relX / chartW) * (totalPointsInWindow - 1));
    const targetIdx = windowSliceRange.startIdx + pointIdxInWindow;

    // Collect point info from all visible traces
    let sampleTime = '';
    const sampledPoints: { label: string; value: number; unit: string; color: string }[] = [];

    visibleTraces.forEach((trace) => {
      const pts = activeData[trace.id] || [];
      const localIdx = targetIdx - (maxAvailablePoints - pts.length);
      if (localIdx >= 0 && localIdx < pts.length) {
        const pt = pts[localIdx];
        if (!sampleTime) sampleTime = pt.timestamp;
        sampledPoints.push({
          label: `${trace.displayAddress} ${trace.label}`,
          value: pt.value,
          unit: trace.unit,
          color: trace.color,
        });
      }
    });

    if (sampledPoints.length > 0) {
      setHoverInfo({
        x: mouseX,
        y: mouseY,
        timestamp: sampleTime,
        points: sampledPoints,
      });
    } else {
      setHoverInfo(null);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setIsDragging(true);
    setDragStartX(e.clientX - rect.left);
    setDragStartOffset(panOffset);
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  const handleCanvasMouseLeave = () => {
    setIsDragging(false);
    setHoverInfo(null);
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      // Zoom in
      setViewPointsCount((prev) => Math.max(15, prev - 10));
    } else {
      // Zoom out
      setViewPointsCount((prev) => Math.min(300, prev + 15));
    }
  };

  // Export CSV for all traces
  const handleExportCSV = () => {
    if (traces.length === 0 || maxAvailablePoints === 0) return;

    // Get union of timestamps or base on trace 0
    const primaryTrace = traces[0];
    const primaryPts = activeData[primaryTrace.id] || [];

    const headers = ['Timestamp', ...traces.map((t) => `"${t.displayAddress} - ${t.label} (${t.unit})"` )];
    const lines = [headers.join(',')];

    primaryPts.forEach((p, idx) => {
      const row = [p.timestamp];
      traces.forEach((t) => {
        const pts = activeData[t.id] || [];
        const val = pts[idx] ? pts[idx].value : '';
        row.push(String(val));
      });
      lines.push(row.join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Trend_MultiTrace_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (traces.length === 0) {
    if (!isFullScreen) return null;
    return (
      <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden select-none">
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            <span className="font-bold text-slate-100 text-sm">Biểu Đồ Xu Hướng Đa Kênh (Realtime Trend)</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-semibold"
          >
            Quay lại Bảng Dữ Liệu
          </button>
        </div>

        {/* Empty State Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center max-w-3xl mx-auto w-full">
          <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center mb-4 shadow-lg shadow-cyan-950/50">
            <LineChart className="w-8 h-8 text-cyan-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Chưa có kênh nào được theo dõi trên Biểu Đồ Sóng</h2>
          <p className="text-slate-400 text-xs text-center max-w-md mb-6 leading-relaxed">
            Bạn có thể theo dõi sự thay đổi của các thanh ghi hoặc cuộn hút Modbus theo thời gian thực (hỗ trợ phóng to/thu nhỏ dòng thời gian, chuẩn hóa thang %, tạm dừng phân tích và xuất dữ liệu CSV).
          </p>

          {availableRows && availableRows.length > 0 ? (
            <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider">Chọn nhanh thanh ghi từ phiên hiện tại:</h3>
                  <p className="text-[11px] text-slate-400">Bấm "+ Vẽ sóng" để bắt đầu quan sát kênh đó:</p>
                </div>
                {onAddTrace && (
                  <button
                    onClick={() => {
                      availableRows.slice(0, 4).forEach((r) => onAddTrace(r));
                    }}
                    className="px-3 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition text-xs font-bold"
                  >
                    + Vẽ nhanh 4 kênh đầu
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[340px] overflow-y-auto pr-1">
                {availableRows.map((row) => (
                  <div
                    key={row.address}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 hover:border-cyan-500/40 transition group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-400 font-bold text-xs">{row.displayAddress}</span>
                        <span className="text-slate-200 text-xs font-medium truncate">
                          {row.alias || `Thanh ghi ${row.displayAddress}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-mono">
                        <span>Giá trị: <strong className="text-amber-300">{row.displayValue}</strong> {row.unit}</span>
                      </div>
                    </div>

                    {onAddTrace && (
                      <button
                        onClick={() => onAddTrace(row)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 group-hover:bg-cyan-600 text-slate-300 group-hover:text-white transition text-xs font-semibold shrink-0"
                      >
                        + Vẽ sóng
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center p-6 bg-slate-900/60 border border-slate-800 rounded-2xl max-w-sm">
              <p className="text-slate-400 text-xs mb-4">Chưa có kết nối hoặc dữ liệu thanh ghi nào để chọn.</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-cyan-400 text-slate-950 font-bold text-xs hover:bg-cyan-300 transition"
              >
                Về Bảng Dữ Liệu & Bật Polling
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-slate-950 text-xs font-sans shadow-2xl relative ${
        isFullScreen
          ? 'flex-1 h-full border-0'
          : isExpanded
          ? 'h-[480px] border-t border-cyan-800/40'
          : 'h-[360px] border-t border-cyan-800/40'
      }`}
    >
      {/* Top Header & Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-slate-200 select-none gap-2">
        {/* Left: Title & Realtime Status */}
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-slate-100 text-sm">Thẻ Động & Biểu Đồ Sóng</span>
          <span className="text-slate-500 font-mono text-[11px]">
            ({traces.length} tag • {Math.min(viewPointsCount, maxAvailablePoints)}/{maxAvailablePoints} mẫu)
          </span>

          {/* Pan offset badge / Back to Live */}
          {panOffset > 0 && (
            <button
              onClick={() => setPanOffset(0)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-600/30 text-rose-300 border border-rose-500/50 hover:bg-rose-600/40 text-[11px] animate-pulse transition-all font-medium"
              title="Đang xem lịch sử cũ. Nhấp để quay về bám sát thời gian thực (Auto Follow)"
            >
              <Radio className="w-3 h-3 text-rose-400" />
              <span>Trở Về Live</span>
            </button>
          )}
        </div>

        {/* Center: Layout Mode, Grid Columns & Zoom Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 gap-1">
            <LayoutGrid className="w-3 h-3 text-cyan-400" />
            <select
              value={displayLayout}
              onChange={(e) => setDisplayLayout(e.target.value as 'both' | 'cards' | 'chart')}
              className="bg-transparent text-[11px] font-semibold text-cyan-300 focus:outline-none cursor-pointer"
              title="Chế độ hiển thị Thẻ Động và Biểu Đồ Sóng"
            >
              <option value="both" className="bg-slate-900 text-slate-200">🎛️+📈 Thẻ & Sóng</option>
              <option value="cards" className="bg-slate-900 text-slate-200">🎛️ Chỉ Thẻ Động</option>
              <option value="chart" className="bg-slate-900 text-slate-200">📈 Chỉ Biểu Đồ</option>
            </select>
            {displayLayout !== 'chart' && (
              <>
                <div className="h-3.5 w-px bg-slate-800 mx-0.5" />
                <select
                  value={gridCols}
                  onChange={(e) => setGridCols(e.target.value as 'auto' | '2' | '3' | '4')}
                  className="bg-transparent text-[11px] font-mono text-slate-300 focus:outline-none cursor-pointer"
                  title="Số cột lưới Thẻ Động"
                >
                  <option value="auto" className="bg-slate-900 text-slate-200">Lưới Auto</option>
                  <option value="2" className="bg-slate-900 text-slate-200">2 Cột</option>
                  <option value="3" className="bg-slate-900 text-slate-200">3 Cột</option>
                  <option value="4" className="bg-slate-900 text-slate-200">4 Cột</option>
                </select>
              </>
            )}
          </div>

          <div className="flex items-center space-x-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            <button
              onClick={() => setViewPointsCount((p) => Math.max(15, p - 10))}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="Phóng to dòng thời gian (Zoom In)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-cyan-300 px-1">{viewPointsCount} pts</span>
            <button
              onClick={() => setViewPointsCount((p) => Math.min(300, p + 15))}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="Thu nhỏ dòng thời gian (Zoom Out)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <div className="h-3.5 w-px bg-slate-800 mx-1" />
            <button
              onClick={() => {
                setPanOffset(0);
                setViewPointsCount(60);
              }}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors text-[10px]"
              title="Đặt lại khung nhìn mặc định"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center space-x-1.5">
          {/* Quick Add Channel Dropdown */}
          {availableRows && availableRows.length > 0 && onAddTrace && (
            <div className="relative">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-semibold bg-cyan-950/80 border border-cyan-600/50 text-cyan-300 hover:bg-cyan-900 transition"
                title="Thêm thanh ghi khác vào biểu đồ sóng"
              >
                <Plus className="w-3 h-3" />
                <span>Thêm Kênh</span>
              </button>
              {showAddMenu && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-30 p-2 max-h-72 overflow-y-auto">
                  <div className="text-[10px] text-slate-400 uppercase font-bold px-2 py-1 border-b border-slate-800 mb-1">
                    Chọn kênh để vẽ thêm:
                  </div>
                  {availableRows.map((r) => {
                    const isTraced = traces.some((t) => t.address === r.address);
                    return (
                      <button
                        key={r.address}
                        disabled={isTraced}
                        onClick={() => {
                          onAddTrace(r);
                          setShowAddMenu(false);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs transition ${
                          isTraced ? 'opacity-40 cursor-not-allowed bg-slate-950/40 text-slate-500' : 'hover:bg-slate-800 text-slate-200'
                        }`}
                      >
                        <span className="font-mono text-cyan-400">{r.displayAddress}</span>
                        <span className="truncate max-w-[100px] text-[11px] text-slate-400">{r.alias || r.displayValue}</span>
                        <span className="text-[10px] font-bold text-amber-300">{isTraced ? 'Đang vẽ' : '+ Thêm'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Normalized Scale Toggle */}
          <button
            onClick={() => setIsNormalizedScale(!isNormalizedScale)}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-semibold border transition ${
              isNormalizedScale
                ? 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-600 shadow-sm'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
            }`}
            title="Tự động chuẩn hóa biên độ từng kênh (Auto-scaled 0-100%): Giúp quan sát rõ sóng hình sin của cả Điện áp 220V và Dòng điện 5A trên cùng một biểu đồ"
          >
            <Sliders className="w-3 h-3 text-fuchsia-400" />
            <span>{isNormalizedScale ? 'Thang %' : 'Thang Tuyệt Đối'}</span>
          </button>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2 py-1 rounded flex items-center space-x-1 transition-colors ${
              isPaused
                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title={isPaused ? 'Tiếp tục bám sóng trực tiếp' : 'Tạm dừng đóng băng biểu đồ để phân tích'}
          >
            {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3" />}
            <span className="text-[11px]">{isPaused ? 'Resume' : 'Pause'}</span>
          </button>


          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Xuất toàn bộ dữ liệu các kênh ra file CSV"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear history */}
          <button
            onClick={onClear}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition-colors"
            title="Xóa toàn bộ lịch sử đo"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Expand / Minimize */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title={isExpanded ? 'Thu nhỏ biểu đồ' : 'Mở rộng biểu đồ'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-rose-900/50 text-slate-400 hover:text-white transition-colors"
            title="Đóng bảng biểu đồ"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* SCADA Dynamic Telemetry Cards Grid */}
      {displayLayout !== 'chart' && (
        <div
          className={`px-3 py-2 bg-slate-950/95 border-b border-slate-900 overflow-y-auto select-none ${
            displayLayout === 'cards' ? 'flex-1' : 'max-h-44'
          }`}
        >
          <div
            className="grid gap-2.5"
            style={{
              gridTemplateColumns:
                gridCols === 'auto'
                  ? 'repeat(auto-fill, minmax(240px, 1fr))'
                  : `repeat(${gridCols}, minmax(0, 1fr))`,
            }}
          >
            {traces.map((trace, idx) => {
              const stats = traceStats[trace.id] || { current: 0, min: 0, max: 0, avg: 0 };
              const row = rowByAddress.get(trace.address);
              const pts = activeData[trace.id] || [];
              const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
              const lastTimeStr = row?.lastUpdated || lastPt?.timestamp || '--:--:--';
              const decodedBadge = row ? decodeRegisterStateBadge(row, isCoil) : null;
              const ctrl = row?.control;
              const rawNum =
                row && row.rawValue !== null && row.rawValue !== undefined
                  ? typeof row.rawValue === 'boolean'
                    ? row.rawValue
                      ? 1
                      : 0
                    : Number(row.rawValue)
                  : stats.current;

              return (
                <div
                  key={trace.id}
                  style={{
                    borderTopColor: trace.color,
                    gridColumn: trace.span === 2 ? 'span 2 / span 2' : undefined,
                  }}
                  className={`flex flex-col justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 border-t-[3px] shadow-lg transition-all ${
                    !trace.visible ? 'opacity-50' : ''
                  }`}
                >
                  {/* Card Header: Color Dot + Tag Name + Reorder/Span/Actions */}
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: trace.color }}
                        />
                        <span
                          className="font-bold text-slate-100 text-xs truncate"
                          title={row?.alias || trace.label}
                        >
                          {row?.alias || trace.label}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
                        {trace.displayAddress} • {trace.tabTitle}
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      {onMoveTrace && (
                        <>
                          <button
                            disabled={idx === 0}
                            onClick={() => onMoveTrace(trace.id, -1)}
                            className="p-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-cyan-300 disabled:opacity-30"
                            title="Di chuyển thẻ sang trái"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            disabled={idx === traces.length - 1}
                            onClick={() => onMoveTrace(trace.id, 1)}
                            className="p-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-cyan-300 disabled:opacity-30"
                            title="Di chuyển thẻ sang phải"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {onToggleTraceSpan && (
                        <button
                          onClick={() => onToggleTraceSpan(trace.id)}
                          className="px-1 py-0.5 rounded bg-slate-950/80 border border-slate-800 text-[9px] font-mono text-slate-400 hover:text-cyan-300"
                          title="Đổi độ rộng thẻ trên lưới (1 cột / 2 cột)"
                        >
                          {trace.span === 2 ? '2x' : '1x'}
                        </button>
                      )}
                      {onRenameTrace && (
                        <button
                          onClick={() => {
                            const nextName = window.prompt(
                              `Đổi tên Tag (${trace.displayAddress}):`,
                              row?.alias || trace.label
                            );
                            if (nextName !== null && nextName.trim()) {
                              onRenameTrace(trace, nextName.trim());
                            }
                          }}
                          className="p-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-amber-300"
                          title="Sửa tên Tag"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => onToggleTraceVisibility(trace.id)}
                        className="p-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-slate-200"
                        title={trace.visible ? 'Ẩn sóng' : 'Hiện sóng'}
                      >
                        {trace.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                      </button>
                      <button
                        onClick={() => onRemoveTrace(trace.id)}
                        className="p-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-rose-400"
                        title="Xóa thẻ theo dõi"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Realtime Value + Decoded State Badge */}
                  <div className="flex items-baseline justify-between gap-2 my-1.5 flex-wrap">
                    <div className="flex items-baseline gap-1">
                      <span
                        className="font-mono font-extrabold text-lg leading-none"
                        style={{ color: trace.color }}
                      >
                        {row?.hasValue ? row.displayValue : stats.current.toFixed(2)}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {row?.unit || trace.unit}
                      </span>
                    </div>

                    {decodedBadge && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          decodedBadge.tone === 'on'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : decodedBadge.tone === 'enum'
                            ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                            : decodedBadge.tone === 'bits'
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                            : 'bg-slate-800/80 text-slate-400 border-slate-700'
                        }`}
                      >
                        {decodedBadge.text}
                      </span>
                    )}
                  </div>

                  {/* Inline Quick Controls inside Card (DO Toggle / Multistate Dropdown / Stepper) */}
                  {ctrl && ctrl.type !== 'none' && (onInlineWrite || onToggleCoil) && (
                    <div className="flex items-center gap-1.5 mb-1.5 pt-1 border-t border-slate-800/60">
                      {ctrl.type === 'toggle' && (
                        <>
                          <button
                            onClick={() => {
                              if (isCoil && onToggleCoil) {
                                onToggleCoil(trace.address, false);
                              } else if (onInlineWrite) {
                                onInlineWrite(trace.address, String(ctrl.onValue ?? 1));
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                              rawNum === (ctrl.onValue ?? 1)
                                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/50'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-emerald-300'
                            }`}
                          >
                            ON
                          </button>
                          <button
                            onClick={() => {
                              if (isCoil && onToggleCoil) {
                                onToggleCoil(trace.address, true);
                              } else if (onInlineWrite) {
                                onInlineWrite(trace.address, String(ctrl.offValue ?? 0));
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                              rawNum === (ctrl.offValue ?? 0)
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-rose-300'
                            }`}
                          >
                            OFF
                          </button>
                        </>
                      )}

                      {ctrl.type === 'dropdown' && ctrl.options && onInlineWrite && (
                        <select
                          value={Math.round(rawNum)}
                          onChange={(e) => onInlineWrite(trace.address, e.target.value)}
                          className="w-full bg-slate-950 border border-purple-500/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-purple-200 focus:outline-none"
                        >
                          {ctrl.options.map((opt) => (
                            <option key={opt.value} value={opt.value} className="bg-slate-900">
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {ctrl.type === 'stepper' && onInlineWrite && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              const step = ctrl.step || 1;
                              const nextVal = rawNum - step;
                              onInlineWrite(
                                trace.address,
                                String(ctrl.min !== undefined ? Math.max(ctrl.min, nextVal) : nextVal)
                              );
                            }}
                            className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 hover:bg-slate-800 font-mono font-bold text-[10px]"
                          >
                            -{ctrl.step || 1}
                          </button>
                          <button
                            onClick={() => {
                              const step = ctrl.step || 1;
                              const nextVal = rawNum + step;
                              onInlineWrite(
                                trace.address,
                                String(ctrl.max !== undefined ? Math.min(ctrl.max, nextVal) : nextVal)
                              );
                            }}
                            className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 hover:bg-slate-800 font-mono font-bold text-[10px]"
                          >
                            +{ctrl.step || 1}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Card Footer: Timestamp & Min/Max/Avg */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/70">
                    <span className="flex items-center gap-1 text-cyan-400/90" title="Thời điểm cập nhật giá trị gần nhất">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{lastTimeStr}</span>
                    </span>
                    <span className="truncate">
                      Min:{stats.min.toFixed(1)} Max:{stats.max.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Canvas Area with Pan/Zoom & Inspection Cursor */}
      {displayLayout !== 'cards' && (
        <div className="flex-1 relative w-full h-full bg-slate-950/90 cursor-crosshair overflow-hidden min-h-[140px]">
          <canvas
            ref={canvasRef}
            onMouseMove={handleCanvasMouseMove}
            onMouseDown={handleCanvasMouseDown}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            onWheel={handleWheel}
            className="w-full h-full block"
          />

          {/* Floating Crosshair HUD Tooltip */}
          {hoverInfo && (
            <div
              className="absolute z-20 pointer-events-none bg-slate-900/95 border border-slate-700/80 rounded-lg p-2.5 shadow-2xl backdrop-blur-sm text-xs font-mono min-w-[180px]"
              style={{
                left: Math.min(hoverInfo.x + 15, (containerRef.current?.clientWidth || 800) - 210),
                top: Math.max(10, Math.min(hoverInfo.y - 40, (containerRef.current?.clientHeight || 300) - 130)),
              }}
            >
              <div className="text-slate-400 font-sans border-b border-slate-800 pb-1 mb-1.5 flex items-center justify-between text-[11px]">
                <span>Mốc thời gian:</span>
                <span className="text-cyan-400 font-bold">{hoverInfo.timestamp}</span>
              </div>
              <div className="space-y-1">
                {hoverInfo.points.map((pt, i) => (
                  <div key={i} className="flex items-center justify-between space-x-3">
                    <div className="flex items-center space-x-1.5 truncate max-w-[130px]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.color }} />
                      <span className="text-slate-300 font-sans truncate">{pt.label}</span>
                    </div>
                    <span className="font-bold font-mono" style={{ color: pt.color }}>
                      {pt.value.toFixed(2)} {pt.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pan helper hint */}
          <div className="absolute bottom-1 right-14 text-[10px] text-slate-600 font-sans pointer-events-none select-none">
            Kéo chuột để di chuyển (Pan) • Lăn chuột để phóng to/thu nhỏ (Zoom)
          </div>
        </div>
      )}
    </div>
  );
};
