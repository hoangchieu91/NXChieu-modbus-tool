import React from 'react';
import { Activity, AlertTriangle, Clock, Radio, Server, Shield } from 'lucide-react';
import { ConnectionConfig, PollDefinition, SessionRole, SlaveConfig, SlaveTable } from '../types/modbus';

interface StatusBarProps {
  role: SessionRole;
  // Master props
  isConnected: boolean;
  isPolling: boolean;
  connectionConfig: ConnectionConfig | null;
  definition: PollDefinition;
  txCount: number;
  errCount: number;
  latencyMs: number;
  // Slave props
  isListening?: boolean;
  slaveConfig?: SlaveConfig;
  slaveTable?: SlaveTable;
  slaveActivityCount?: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  role,
  isConnected,
  isPolling,
  connectionConfig,
  definition,
  txCount,
  errCount,
  latencyMs,
  isListening,
  slaveConfig,
  slaveTable,
  slaveActivityCount = 0,
}) => {
  if (role === 'slave') {
    const slaveListenLabel = slaveConfig
      ? slaveConfig.type === 'serial'
        ? `${slaveConfig.port} (${slaveConfig.baud_rate || 9600} ${slaveConfig.data_bits || 8}-${(slaveConfig.parity || 'n')[0].toUpperCase()}-${slaveConfig.stop_bits || 1})`
        : `${slaveConfig.type.toUpperCase()}: ${slaveConfig.host || '0.0.0.0'}:${slaveConfig.port_tcp || 5020}`
      : 'Chưa cấu hình cổng';

    return (
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[11px] font-mono text-slate-400 select-none">
        {/* Left side: Slave status */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                isListening ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className={`font-semibold ${isListening ? 'text-amber-300' : 'text-slate-500'}`}>
              {isListening ? 'SLAVE LISTENING' : 'SLAVE STOPPED'}
            </span>
          </div>

          <div className="h-3 w-px bg-slate-700/80" />

          <div className="flex items-center space-x-1 text-slate-300">
            <Server className="w-3 h-3 text-amber-400" />
            <span>{slaveListenLabel}</span>
          </div>

          <div className="h-3 w-px bg-slate-700/80" />

          <div className="flex items-center space-x-1 text-slate-300">
            <Shield className="w-3 h-3 text-amber-400" />
            <span>
              Device ID: <strong className="text-amber-300">{slaveConfig?.slave_id || 1}</strong> | Vùng nhớ: <strong className="text-slate-200">{(slaveTable || 'holding').toUpperCase()}</strong>
            </span>
          </div>
        </div>

        {/* Right side: Handled requests */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <Activity className="w-3 h-3 text-emerald-400" />
            <span>
              Yêu cầu đã xử lý (Handled): <strong className="text-emerald-300">{slaveActivityCount}</strong>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Master mode
  const connectionLabel = connectionConfig
    ? connectionConfig.type === 'serial'
      ? `${connectionConfig.port} (${connectionConfig.baud_rate} ${connectionConfig.data_bits}-${connectionConfig.parity[0].toUpperCase()}-${connectionConfig.stop_bits})`
      : `${connectionConfig.type.toUpperCase()}: ${connectionConfig.host}:${connectionConfig.port}`
    : 'Not Connected';

  const fcLabel =
    definition.function_code === 1
      ? 'FC 01 (Coils)'
      : definition.function_code === 2
      ? 'FC 02 (Discrete)'
      : definition.function_code === 3
      ? 'FC 03 (Holding)'
      : 'FC 04 (Input)';

  const errPercentage = txCount > 0 ? ((errCount / txCount) * 100).toFixed(1) : '0.0';

  return (
    <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[11px] font-mono text-slate-400 select-none">
      {/* Left side: Connection info */}
      <div className="flex items-center space-x-3">
        {/* Connection status badge */}
        <div className="flex items-center space-x-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? isPolling
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-emerald-500'
                : 'bg-rose-500'
            }`}
          />
          <span className={`font-semibold ${isConnected ? 'text-slate-200' : 'text-slate-500'}`}>
            {isConnected ? (isPolling ? 'POLLING' : 'CONNECTED') : 'DISCONNECTED'}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-700/80" />

        {/* Port details */}
        <div className="flex items-center space-x-1 text-slate-300">
          <Server className="w-3 h-3 text-cyan-400" />
          <span>{connectionLabel}</span>
        </div>

        <div className="h-3 w-px bg-slate-700/80" />

        {/* Slave ID & FC */}
        <div className="flex items-center space-x-1 text-slate-300">
          <Radio className="w-3 h-3 text-amber-400" />
          <span>
            Slave ID: <strong className="text-amber-300">{definition.slave_id}</strong> | {fcLabel} | {definition.quantity} Regs
          </span>
        </div>
      </div>

      {/* Right side: Traffic metrics & Performance */}
      <div className="flex items-center space-x-4">
        {/* Latency */}
        <div className="flex items-center space-x-1" title="Round-trip request/response latency">
          <Clock className="w-3 h-3 text-sky-400" />
          <span>
            Latency: <strong className="text-slate-200">{latencyMs} ms</strong>
          </span>
        </div>

        {/* Scan Rate */}
        <div className="flex items-center space-x-1">
          <span>
            Rate: <strong className="text-slate-200">{definition.scan_rate_ms} ms</strong>
          </span>
        </div>

        {/* Tx Count */}
        <div className="flex items-center space-x-1">
          <Activity className="w-3 h-3 text-emerald-400" />
          <span>
            Tx: <strong className="text-emerald-300">{txCount}</strong>
          </span>
        </div>

        {/* Err Count */}
        <div className="flex items-center space-x-1">
          <AlertTriangle
            className={`w-3 h-3 ${errCount > 0 ? 'text-rose-400' : 'text-slate-600'}`}
          />
          <span>
            Err:{' '}
            <strong className={errCount > 0 ? 'text-rose-400' : 'text-slate-400'}>
              {errCount} ({errPercentage}%)
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
};
