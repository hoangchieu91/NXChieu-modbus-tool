import React from 'react';
import {
  Plug,
  Settings,
  Play,
  Square,
  Terminal,
  RefreshCw,
  Shield,
  Radio,
  Server,
  FolderOpen,
  Save,
  FileSpreadsheet,
  HelpCircle,
} from 'lucide-react';
import { SessionRole } from '../types/modbus';

interface MenuBarProps {
  role: SessionRole;
  onRoleChange: (role: SessionRole) => void;
  isConnected: boolean;
  isPolling: boolean;
  isListening?: boolean;
  onOpenConnection: () => void;
  onDisconnect: () => void;
  onOpenDefinition: () => void;
  onOpenSlaveSetup: () => void;
  onTogglePoll: () => void;
  onToggleSlaveServer: () => void;
  onToggleTraffic: () => void;
  showTraffic: boolean;
  onQuickSimulate: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExportCSV: () => void;
  onOpenHelp?: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  role,
  onRoleChange,
  isConnected,
  isPolling,
  isListening,
  onOpenConnection,
  onDisconnect,
  onOpenDefinition,
  onOpenSlaveSetup,
  onTogglePoll,
  onToggleSlaveServer,
  onToggleTraffic,
  showTraffic,
  onQuickSimulate,
  onOpenProject,
  onSaveProject,
  onExportCSV,
  onOpenHelp,
}) => {
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 select-none">
      <div className="flex items-center space-x-1">
        {/* App Logo / Title */}
        <div className="flex items-center space-x-1.5 pr-3 font-semibold text-slate-100 border-r border-slate-700/60 mr-1">
          <div className={`w-2.5 h-2.5 rounded-full ${role === 'slave' ? 'bg-amber-500' : 'bg-cyan-500'} animate-pulse`} />
          <span className={`tracking-wide font-mono ${role === 'slave' ? 'text-amber-400' : 'text-cyan-400'}`}>
            NXChieu Modbus 2-in-1 Suite
          </span>
        </div>

        {/* Project File Operations: Open, Save, Export CSV */}
        <div className="flex items-center space-x-0.5 border-r border-slate-700/60 pr-2 mr-1">
          <button
            onClick={onOpenProject}
            className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors text-slate-300"
            title="Mở tệp dự án Modbus (.nxmodbus / .json)"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Mở Dự Án</span>
          </button>

          <button
            onClick={onSaveProject}
            className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors text-slate-300"
            title="Lưu toàn bộ các Sheet và cấu hình dự án ra file .nxmodbus"
          >
            <Save className="w-3.5 h-3.5 text-emerald-400" />
            <span>Lưu Dự Án</span>
          </button>

          <button
            onClick={onExportCSV}
            className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors text-slate-300"
            title="Xuất bảng thanh ghi của sheet hiện tại ra file CSV để mở bằng Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
            <span>Xuất CSV</span>
          </button>
        </div>

        {/* Connection & Operation Buttons */}
        <div className="flex items-center space-x-0.5">
          {role === 'master' ? (
            <>
              {/* Connection */}
              <button
                onClick={isConnected ? onDisconnect : onOpenConnection}
                className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors"
              >
                <Plug className="w-3.5 h-3.5" />
                <span>{isConnected ? 'Disconnect' : 'Connect (F3)'}</span>
              </button>

              {/* Setup Definition */}
              <button
                onClick={onOpenDefinition}
                className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Read/Write Definition (F8)</span>
              </button>

              {/* Poll / Pause */}
              <button
                onClick={onTogglePoll}
                disabled={!isConnected}
                className={`px-2 py-0.5 rounded flex items-center space-x-1 transition-colors ${
                  !isConnected
                    ? 'opacity-40 cursor-not-allowed'
                    : isPolling
                    ? 'hover:bg-amber-900/40 text-amber-300'
                    : 'hover:bg-emerald-900/40 text-emerald-300'
                }`}
              >
                {isPolling ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPolling ? 'Pause Polling' : 'Start Polling'}</span>
              </button>
            </>
          ) : (
            <>
              {/* Slave Setup */}
              <button
                onClick={onOpenSlaveSetup}
                className="px-2 py-0.5 rounded hover:bg-slate-800 hover:text-white flex items-center space-x-1 transition-colors"
              >
                <Server className="w-3.5 h-3.5 text-amber-400" />
                <span>Slave Server Setup</span>
              </button>

              {/* Listen / Stop */}
              <button
                onClick={onToggleSlaveServer}
                className={`px-2 py-0.5 rounded flex items-center space-x-1 transition-colors ${
                  isListening
                    ? 'hover:bg-rose-900/40 text-rose-300'
                    : 'hover:bg-emerald-900/40 text-emerald-300'
                }`}
              >
                {isListening ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isListening ? 'Stop Listening' : 'Start Listening'}</span>
              </button>
            </>
          )}

          {/* View Traffic */}
          <button
            onClick={onToggleTraffic}
            className={`px-2 py-0.5 rounded flex items-center space-x-1 transition-colors ${
              showTraffic ? 'bg-slate-800 text-cyan-400 font-medium' : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Traffic Log</span>
          </button>

          {/* Role Switch Shortcut in Menu */}
          <button
            onClick={() => onRoleChange(role === 'master' ? 'slave' : 'master')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors ml-2"
            title="Chuyển đổi nhanh vai trò Master / Slave"
          >
            {role === 'master' ? (
              <>
                <Shield className="w-3 h-3 text-amber-400" />
                <span>Switch to Slave</span>
              </>
            ) : (
              <>
                <Radio className="w-3 h-3 text-cyan-400" />
                <span>Switch to Master</span>
              </>
            )}
          </button>

          {/* Virtual Simulator Mode */}
          {role === 'master' && (
            <button
              onClick={onQuickSimulate}
              title="Quick connect to built-in virtual simulated meter"
              className="px-2 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 flex items-center space-x-1 transition-colors ml-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Virtual Sim</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2 text-slate-400 text-[11px]">
        <span className="text-slate-300 font-medium">Modbus RTU / TCP / RTU over TCP</span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-400 font-mono">Master + Slave 2-in-1</span>

        {onOpenHelp && (
          <>
            <span className="text-slate-600">|</span>
            <button
              onClick={onOpenHelp}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/60 font-semibold transition-all shadow-sm"
              title="Mở tài liệu hướng dẫn sử dụng và phím tắt (F1)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
              <span>Hướng Dẫn (F1)</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
