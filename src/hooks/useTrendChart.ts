import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChartTrace, ChartDataPoint, TabSession, RegisterRow } from '../types/modbus';
import { sampleTrace, appendTracePoints, clockStamp, PerTabState } from '../utils/rowBuilder';

export function useTrendChart(
  activeTabId: string,
  splitTabId: string,
  tabStates?: Record<string, PerTabState>
) {
  const [chartTraces, setChartTraces] = useState<ChartTrace[]>([]);
  const [traceData, setTraceData] = useState<Record<string, ChartDataPoint[]>>({});
  const [isChartVisible, setIsChartVisible] = useState<boolean>(false);

  const TRACE_PALETTE = useMemo(
    () => [
      '#06b6d4', // cyan-500
      '#f59e0b', // amber-500
      '#10b981', // emerald-500
      '#8b5cf6', // violet-500
      '#ec4899', // pink-500
      '#3b82f6', // blue-500
      '#f97316', // orange-500
      '#14b8a6', // teal-500
      '#a855f7', // purple-500
      '#eab308', // yellow-500
      '#6366f1', // indigo-500
      '#84cc16', // lime-500
    ],
    []
  );

  const chartTracesRef = useRef<ChartTrace[]>(chartTraces);
  useEffect(() => {
    chartTracesRef.current = chartTraces;
  }, [chartTraces]);

  const tabStatesRef = useRef<Record<string, PerTabState> | undefined>(tabStates);
  useEffect(() => {
    tabStatesRef.current = tabStates;
  }, [tabStates]);

  const handleToggleTrace = useCallback(
    (tab: TabSession, row: RegisterRow, tabState?: PerTabState) => {
      const traceId = `${tab.id}_${row.address}`;
      const existingIdx = chartTraces.findIndex((t) => t.id === traceId);

      if (existingIdx >= 0) {
        const updated = chartTraces.filter((t) => t.id !== traceId);
        setChartTraces(updated);
        if (updated.length === 0) {
          setIsChartVisible(false);
        }
      } else {
        const used = new Set(chartTraces.map((t) => t.color));
        const nextColor =
          TRACE_PALETTE.find((c) => !used.has(c)) ??
          TRACE_PALETTE[chartTraces.length % TRACE_PALETTE.length];
        const newTrace: ChartTrace = {
          id: traceId,
          tabId: tab.id,
          tabTitle: tab.title,
          address: row.address,
          label: row.alias || `Register ${row.address}`,
          unit: row.unit || '',
          displayAddress: row.displayAddress,
          color: nextColor,
          visible: true,
        };

        setChartTraces((prev) => [...prev, newTrace]);
        setIsChartVisible(true);

        const targetState = tabState || tabStatesRef.current?.[tab.id];
        if (row.hasValue && targetState) {
          const start = tab.role === 'slave' ? tab.slaveStartAddr : tab.definition.start_address;
          const fmt = tab.formats?.[row.address] || tab.format;
          const val = sampleTrace(
            targetState.regs,
            targetState.coils,
            row.address - start,
            fmt,
            tab.scalings?.[row.address] ?? 1
          );
          if (Number.isFinite(val)) {
            const timeNow = new Date();
            const timeStr = clockStamp(timeNow);
            setTraceData((prev) => ({
              ...prev,
              [traceId]: [{ timestamp: timeStr, timeMs: timeNow.getTime(), value: val }],
            }));
          }
        }
      }
    },
    [chartTraces, TRACE_PALETTE]
  );

  const handleToggleTraceVisibility = useCallback((traceId: string) => {
    setChartTraces((prev) =>
      prev.map((t) => (t.id === traceId ? { ...t, visible: !t.visible } : t))
    );
  }, []);

  const handleRemoveTrace = useCallback((traceId: string) => {
    setChartTraces((prev) => {
      const updated = prev.filter((t) => t.id !== traceId);
      if (updated.length === 0) {
        setIsChartVisible(false);
      }
      return updated;
    });
  }, []);

  const handleClearAllChart = useCallback(() => {
    setTraceData({});
  }, []);

  const resetAllTraces = useCallback(() => {
    setChartTraces([]);
    setTraceData({});
  }, []);

  const removeTracesForTab = useCallback((tabId: string) => {
    setChartTraces((prev) => prev.filter((t) => t.tabId !== tabId));
    setTraceData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((tid) => {
        if (tid.startsWith(`${tabId}_`)) {
          delete next[tid];
        }
      });
      return next;
    });
  }, []);

  const ingestSamplePoints = useCallback(
    (
      targetId: string,
      values: number[],
      bools: boolean[],
      startAddr: number,
      targetTab: TabSession,
      timeStr: string,
      timeMs: number
    ) => {
      if (chartTracesRef.current.length === 0) return;
      const points: Record<string, { timestamp: string; timeMs: number; value: number }> = {};
      chartTracesRef.current.forEach((trace) => {
        if (trace.tabId === targetId) {
          const regFmt = targetTab.formats?.[trace.address] || targetTab.format;
          const scaling = targetTab.scalings?.[trace.address] ?? 1;
          const value = sampleTrace(values, bools, trace.address - startAddr, regFmt, scaling);
          if (Number.isFinite(value)) {
            points[trace.id] = { timestamp: timeStr, timeMs, value };
          }
        }
      });
      if (Object.keys(points).length > 0) {
        setTraceData((prev) => appendTracePoints(prev, points));
      }
    },
    []
  );

  const activeChartColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    chartTraces.forEach((t) => {
      if (t.tabId === activeTabId) {
        map[t.address] = t.color;
      }
    });
    return map;
  }, [chartTraces, activeTabId]);

  const splitChartColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    chartTraces.forEach((t) => {
      if (t.tabId === splitTabId) {
        map[t.address] = t.color;
      }
    });
    return map;
  }, [chartTraces, splitTabId]);

  return {
    chartTraces,
    traceData,
    isChartVisible,
    setIsChartVisible,
    chartTracesRef,
    handleToggleTrace,
    handleToggleTraceVisibility,
    handleRemoveTrace,
    handleClearAllChart,
    resetAllTraces,
    removeTracesForTab,
    ingestSamplePoints,
    activeChartColorMap,
    splitChartColorMap,
  };
}
