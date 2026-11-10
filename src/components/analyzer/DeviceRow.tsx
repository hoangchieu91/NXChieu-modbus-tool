import React from 'react';
import { ModbusDeviceHealth, SnifferDeviceBaseline } from '../../types/modbus';
import { stateTone, stateLabel, formatLatency } from './analyzerUtils';

interface DeviceRowProps {
  device: ModbusDeviceHealth;
  baseline?: SnifferDeviceBaseline;
  selected: boolean;
  onClick: () => void;
}

export const DeviceRow: React.FC<DeviceRowProps> = ({
  device,
  baseline,
  selected,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-3 py-2.5 border-b border-slate-800/70 transition ${
      selected ? 'bg-cyan-400/10 border-l-2 border-l-cyan-400' : 'hover:bg-slate-900/80 border-l-2 border-l-transparent'
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono font-bold text-slate-100">UNIT {String(device.unit_id).padStart(3, '0')}</span>
      <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${stateTone[device.state] || stateTone.unknown}`}>
        {stateLabel[device.state] || device.state}
      </span>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
      <span>Success <b className="text-slate-300">{device.success_rate.toFixed(1)}%</b></span>
      <span>P95 <b className="text-slate-300">{formatLatency(device.p95_latency_us)}</b></span>
      <span>REQ <b className="text-sky-300">{device.requests}</b></span>
      <span>RSP <b className="text-emerald-300">{device.responses}</b></span>
    </div>
    {baseline && (
      <div className="mt-1.5 border-t border-slate-800/60 pt-1 text-[9px] text-slate-500 font-mono flex items-center justify-between">
        <span>Base P95: <b className="text-cyan-400">{formatLatency(baseline.p95_latency_us)}</b></span>
        <span>Poll ~<b className="text-cyan-400">{Math.round(baseline.median_poll_interval_ms)}ms</b></span>
      </div>
    )}
  </button>
);
