import React, { useState, useRef, useEffect } from 'react';
import {
  FolderOpen,
  Save,
  FileSpreadsheet,
  Zap,
  Play,
  Square,
  Activity,
  Sliders,
  Search,
  Smartphone,
  HelpCircle,
  RotateCcw,
  Unplug,
  Plug,
  Settings,
  ChevronDown,
  Terminal,
  Columns2,
  RefreshCw,
} from 'lucide-react';
import { SessionRole } from '../types/modbus';

interface ModernMenuBarProps {
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
  onReadOnce: () => void;
  onClearCounters: () => void;
  onQuickSimulate: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExportCSV: () => void;
  onToggleTraffic: () => void;
  showTraffic: boolean;
  isSplitView?: boolean;
  onToggleSplitView?: () => void;
  showInspector?: boolean;
  onToggleInspector?: () => void;
  onOpenScanner?: () => void;
  onOpenMobileRemote?: () => void;
  onOpenProtocolAnalyzer?: () => void;
  onOpenHelp?: () => void;
}

export const MenuBar: React.FC<ModernMenuBarProps> = ({
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
  onReadOnce,
  onClearCounters,
  onQuickSimulate,
  onOpenProject,
  onSaveProject,
  onExportCSV,
  onToggleTraffic,
  showTraffic,
  isSplitView,
  onToggleSplitView,
  showInspector,
  onToggleInspector,
  onOpenScanner,
  onOpenMobileRemote,
  onOpenProtocolAnalyzer,
  onOpenHelp,
}) => {
  const [openMenu, setOpenMenu] = useState<'file' | 'connection' | 'tools' | 'view' | 'help' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleItemClick = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <div
      ref={menuRef}
      className="flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 select-none relative z-30"
    >
      {/* Left: App Brand & Dropdown Menus */}
      <div className="flex items-center space-x-1">
        {/* App Logo & Title */}
        <div className="flex items-center space-x-2 pr-3 mr-1 border-r border-slate-700/60 font-semibold text-slate-100">
          <div className={`w-2.5 h-2.5 rounded-full ${role === 'slave' ? 'bg-amber-400' : 'bg-cyan-400'} shadow-sm`} />
          <span className="font-mono tracking-wide text-xs">
            NXChieu <span className={role === 'slave' ? 'text-amber-400' : 'text-cyan-400'}>Modbus Suite</span>
          </span>
        </div>

        {/* 1. TỆP (FILE) */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            className={`px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1 ${
              openMenu === 'file' ? 'bg-slate-800 text-white' : ''
            }`}
          >
            <span>Tệp (File)</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>
          {openMenu === 'file' && (
            <div className="absolute left-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs text-slate-200">
              <button
                onClick={() => handleItemClick(onOpenProject)}
                className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
              >
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span className="flex-1">Mở dự án...</span>
                <span className="text-[10px] text-slate-500 font-mono">Ctrl+O</span>
              </button>
              <button
                onClick={() => handleItemClick(onSaveProject)}
                className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
              >
                <Save className="w-4 h-4 text-emerald-400" />
                <span className="flex-1">Lưu dự án (.nxmodbus)</span>
                <span className="text-[10px] text-slate-500 font-mono">Ctrl+S</span>
              </button>
              <div className="h-px bg-slate-800 my-1" />
              <button
                onClick={() => handleItemClick(onExportCSV)}
                className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
              >
                <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
                <span>Xuất bảng ra Excel (CSV)</span>
              </button>
            </div>
          )}
        </div>

        {/* 2. KẾT NỐI (CONNECTION) */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'connection' ? null : 'connection')}
            className={`px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1 ${
              openMenu === 'connection' ? 'bg-slate-800 text-white' : ''
            }`}
          >
            <span>Kết Nối (Connection)</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>
          {openMenu === 'connection' && (
            <div className="absolute left-0 mt-1 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs text-slate-200">
              {role === 'master' ? (
                <>
                  <button
                    onClick={() => handleItemClick(isConnected ? onDisconnect : onOpenConnection)}
                    className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                  >
                    {isConnected ? <Unplug className="w-4 h-4 text-rose-400" /> : <Plug className="w-4 h-4 text-cyan-400" />}
                    <span className="flex-1">{isConnected ? 'Ngắt kết nối' : 'Kết nối Modbus...'}</span>
                    <span className="text-[10px] text-slate-500 font-mono">F3</span>
                  </button>
                  <button
                    onClick={() => handleItemClick(onOpenDefinition)}
                    className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                  >
                    <Settings className="w-4 h-4 text-cyan-400" />
                    <span className="flex-1">Cài đặt quét (Definition)...</span>
                    <span className="text-[10px] text-slate-500 font-mono">F8</span>
                  </button>
                  <div className="h-px bg-slate-800 my-1" />
                  <button
                    onClick={() => handleItemClick(onQuickSimulate)}
                    className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                  >
                    <Zap className="w-4 h-4 text-indigo-400" />
                    <span>Kết nối Đồng hồ điện ảo (Virtual Sim)</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleItemClick(onToggleSlaveServer)}
                    className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                  >
                    {isListening ? <Square className="w-4 h-4 text-rose-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
                    <span className="flex-1">{isListening ? 'Dừng Slave Server' : 'Khởi chạy Slave Server'}</span>
                  </button>
                  <button
                    onClick={() => handleItemClick(onOpenSlaveSetup)}
                    className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                  >
                    <Settings className="w-4 h-4 text-amber-400" />
                    <span>Cấu hình cổng & Slave ID...</span>
                  </button>
                </>
              )}
              <div className="h-px bg-slate-800 my-1" />
              <button
                onClick={() => handleItemClick(() => onRoleChange(role === 'master' ? 'slave' : 'master'))}
                className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left text-cyan-300 font-medium"
              >
                <RefreshCw className="w-4 h-4 text-cyan-400" />
                <span>Chuyển sang chế độ {role === 'master' ? 'Slave (Server)' : 'Master (Poll)'}</span>
              </button>
            </div>
          )}
        </div>

        {/* 3. VẬN HÀNH (OPERATION) */}
        {role === 'master' && (
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}
              className={`px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1 ${
                openMenu === 'tools' ? 'bg-slate-800 text-white' : ''
              }`}
            >
              <span>Vận Hành</span>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>
            {openMenu === 'tools' && (
              <div className="absolute left-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs text-slate-200">
                <button
                  disabled={!isConnected}
                  onClick={() => handleItemClick(onTogglePoll)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left disabled:opacity-40"
                >
                  {isPolling ? <Square className="w-4 h-4 text-amber-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
                  <span>{isPolling ? 'Tạm dừng Polling' : 'Bắt đầu Polling liên tục'}</span>
                </button>
                <button
                  disabled={!isConnected || isPolling}
                  onClick={() => handleItemClick(onReadOnce)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left disabled:opacity-40"
                >
                  <Activity className="w-4 h-4 text-sky-400" />
                  <span className="flex-1">Đọc 1 lần (Read Once)</span>
                  <span className="text-[10px] text-slate-500 font-mono">F7</span>
                </button>
                <div className="h-px bg-slate-800 my-1" />
                <button
                  onClick={() => handleItemClick(onClearCounters)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                >
                  <RotateCcw className="w-4 h-4 text-slate-400" />
                  <span>Xóa bộ đếm (Reset Counters)</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4. HIỂN THỊ (VIEW) */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            className={`px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1 ${
              openMenu === 'view' ? 'bg-slate-800 text-white' : ''
            }`}
          >
            <span>Hiển Thị (View)</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>
          {openMenu === 'view' && (
            <div className="absolute left-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs text-slate-200">
              <button
                onClick={() => handleItemClick(onToggleTraffic)}
                className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center justify-between text-left"
              >
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <span>Khung Traffic Log (Hex)</span>
                </div>
                {showTraffic && <span className="text-emerald-400 font-bold">✓</span>}
              </button>
              {onToggleInspector && (
                <button
                  onClick={() => handleItemClick(onToggleInspector)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center justify-between text-left"
                >
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-4 h-4 text-amber-400" />
                    <span>Point Inspector</span>
                  </div>
                  {showInspector && <span className="text-emerald-400 font-bold">✓</span>}
                </button>
              )}
              {onToggleSplitView && (
                <button
                  onClick={() => handleItemClick(onToggleSplitView)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center justify-between text-left"
                >
                  <div className="flex items-center space-x-2">
                    <Columns2 className="w-4 h-4 text-indigo-400" />
                    <span>Split View (Xem song song)</span>
                  </div>
                  {isSplitView && <span className="text-emerald-400 font-bold">✓</span>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 5. CÔNG CỤ (TOOLS) */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}
            className={`px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1 ${
              openMenu === 'tools' ? 'bg-slate-800 text-white' : ''
            }`}
          >
            <span>Công Cụ</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>
          {openMenu === 'tools' && (
            <div className="absolute left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs text-slate-200">
              {onOpenScanner && (
                <button
                  onClick={() => handleItemClick(onOpenScanner)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                >
                  <Search className="w-4 h-4 text-cyan-400" />
                  <span className="flex-1">Bộ Quét Modbus Scanner</span>
                  <span className="text-[10px] text-slate-500 font-mono">F4</span>
                </button>
              )}
              {onOpenMobileRemote && (
                <button
                  onClick={() => handleItemClick(onOpenMobileRemote)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                >
                  <Smartphone className="w-4 h-4 text-purple-400" />
                  <span className="flex-1">Giám sát trên điện thoại (Mobile)</span>
                  <span className="text-[10px] text-slate-500 font-mono">F9</span>
                </button>
              )}
              {onOpenProtocolAnalyzer && (
                <button
                  onClick={() => handleItemClick(onOpenProtocolAnalyzer)}
                  className="w-full px-3 py-1.5 hover:bg-slate-800 flex items-center space-x-2 text-left"
                >
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span className="flex-1">Protocol Analyzer & Bus Health</span>
                  <span className="text-[10px] text-slate-500 font-mono">F10</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 6. TRỢ GIÚP (HELP) */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="px-2.5 py-1 rounded hover:bg-slate-800 hover:text-white transition flex items-center space-x-1"
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Trợ Giúp (F1)</span>
          </button>
        )}
      </div>

      {/* Right: Mode Badge & Quick Info */}
      <div className="flex items-center space-x-2 text-[11px] text-slate-400">
        <span className="text-slate-500 font-mono">Giao thức:</span>
        <span className="text-slate-300 font-medium">RTU / TCP / RTU over TCP</span>
        <span className="text-slate-700">|</span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          role === 'master' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60' : 'bg-amber-950 text-amber-300 border border-amber-800/60'
        }`}>
          {role === 'master' ? 'MASTER MODE' : 'SLAVE MODE'}
        </span>
      </div>
    </div>
  );
};
