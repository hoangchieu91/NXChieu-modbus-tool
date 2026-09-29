import React, { useRef, useEffect, useState } from 'react';
import { Terminal, Trash2, Copy, Check, ArrowDownToLine, Activity } from 'lucide-react';
import { TrafficEntry } from '../types/modbus';

interface TrafficBoxProps {
  entries: TrafficEntry[];
  onClear: () => void;
  onOpenAnalyzer?: () => void;
}

export const TrafficBox: React.FC<TrafficBoxProps> = ({ entries, onClear, onOpenAnalyzer }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleCopy = () => {
    const text = entries
      .map((e) => `[${e.direction.toUpperCase()} ${e.timestamp}] ${e.hex}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-48 flex flex-col bg-slate-950 border-t border-slate-800 text-xs font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-slate-800 text-slate-300 select-none">
        <div className="flex items-center space-x-2">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-slate-200">
            Communication Traffic (Raw Hex Frame Log)
          </span>
          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400">
            {entries.length} frames
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          {onOpenAnalyzer && (
            <button
              onClick={onOpenAnalyzer}
              className="px-2 py-0.5 rounded flex items-center space-x-1 border border-cyan-800/70 bg-cyan-950/50 text-cyan-300 hover:bg-cyan-900/50 transition-colors"
              title="Mở Protocol Analyzer và Bus Health"
            >
              <Activity className="w-3 h-3" />
              <span className="text-[11px]">Analyzer</span>
            </button>
          )}
          {/* Auto Scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded flex items-center space-x-1 transition-colors ${
              autoScroll ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle Auto Scroll"
          >
            <ArrowDownToLine className="w-3 h-3" />
            <span className="text-[11px]">Auto-scroll</span>
          </button>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            disabled={entries.length === 0}
            className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center space-x-1 transition-colors disabled:opacity-40"
            title="Copy all frames to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Clear button */}
          <button
            onClick={onClear}
            disabled={entries.length === 0}
            className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 flex items-center space-x-1 transition-colors disabled:opacity-40"
            title="Clear log"
          >
            <Trash2 className="w-3 h-3" />
            <span className="text-[11px]">Clear</span>
          </button>
        </div>
      </div>

      {/* Frame entries list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 select-text bg-slate-950"
      >
        {entries.length === 0 ? (
          <div className="text-slate-600 text-center py-6">
            Waiting for Modbus communication frames...
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-start space-x-2 leading-relaxed">
              <span className="text-slate-600 select-none text-[11px] min-w-[70px]">
                {entry.timestamp}
              </span>

              {entry.direction === 'tx' && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-sky-950/80 text-sky-400 border border-sky-800/60 select-none">
                  TX
                </span>
              )}
              {entry.direction === 'rx' && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 select-none">
                  RX
                </span>
              )}
              {entry.direction === 'err' && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-950/80 text-rose-400 border border-rose-800/60 select-none">
                  ERR
                </span>
              )}

              <span
                className={`flex-1 break-all ${
                  entry.direction === 'tx'
                    ? 'text-sky-300'
                    : entry.direction === 'rx'
                    ? 'text-emerald-300'
                    : 'text-rose-400'
                }`}
              >
                {entry.description && (
                  <span className="text-amber-400/90 font-sans font-medium mr-2">[{entry.description}]</span>
                )}
                {entry.hex}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
