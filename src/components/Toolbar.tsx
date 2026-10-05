import React from 'react';
import {
  Plug,
  Unplug,
  Settings,
  Play,
  Pause,
  RotateCcw,
  Binary,
  Terminal,
  Activity,
  Plus,
  Shield,
  Radio,
  Server,
  Square,
  Layers,
  Columns2,
  LineChart,
  HelpCircle,
  Search,
  Smartphone,
  Zap,
  PanelsTopLeft,
} from 'lucide-react';
import { DataFormat, SessionRole, SlaveTable } from '../types/modbus';

interface ToolbarProps {
  role: SessionRole;
  onRoleChange: (role: SessionRole) => void;
  // Master props
  isConnected: boolean;
  isPolling: boolean;
  format: DataFormat;
  onFormatChange: (fmt: DataFormat) => void;
  onConnectClick: () => void;
  onDisconnectClick: () => void;
  onDefinitionClick: () => void;
  onTogglePoll: () => void;
  onReadOnce: () => void;
  onClearCounters: () => void;
  // Slave props
  isListening: boolean;
  slaveTable: SlaveTable;
  onTableChange: (table: SlaveTable) => void;
  onOpenSlaveModal: () => void;
  onToggleSlaveServer: () => void;
  // Common & View modes
  onToggleTraffic: () => void;
  showTraffic: boolean;
  onNewTab: () => void;
  isSplitView?: boolean;
  onToggleSplitView?: () => void;
  hasActiveChart?: boolean;
  onToggleChart?: () => void;
  onOpenHelp?: () => void;
  onOpenScanner?: () => void;
  onOpenMobileRemote?: () => void;
  onOpenProtocolAnalyzer?: () => void;
  onOpenAnalyzerStudio?: () => void;
  onOpenWorkspaceStudio?: () => void;
}


export const Toolbar: React.FC<ToolbarProps> = ({
  role,
  onRoleChange,
  isConnected,
  isPolling,
  format,
  onFormatChange,
  onConnectClick,
  onDisconnectClick,
  onDefinitionClick,
  onTogglePoll,
  onReadOnce,
  onClearCounters,
  isListening,
  slaveTable,
  onTableChange,
  onOpenSlaveModal,
  onToggleSlaveServer,
  onToggleTraffic,
  showTraffic,
  onNewTab,
  isSplitView,
  onToggleSplitView,
  hasActiveChart,
  onToggleChart,
  onOpenHelp,
  onOpenScanner,
  onOpenMobileRemote,
  onOpenProtocolAnalyzer,
  onOpenAnalyzerStudio,
  onOpenWorkspaceStudio,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs gap-2">
      {/* Left tool group */}
      <div className="flex items-center space-x-2">
        {/* Role Switcher Pill: Master vs Slave */}
        <div className="flex items-center bg-slate-950 p-0.5 rounded-md border border-slate-700/80 mr-1 shadow-inner">
          <button
            onClick={() => onRoleChange('master')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
              role === 'master'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Chế độ Modbus Master (Poll): Đọc/Ghi dữ liệu từ các thiết bị ngoại vi"
          >
            <Radio className="w-3 h-3" />
            <span>Master (Poll)</span>
          </button>

          <button
            onClick={() => onRoleChange('slave')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
              role === 'slave'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Chế độ Modbus Slave (Server): Giả lập thiết bị PLC/Sensor cho các Master khác kết nối đọc ghi"
          >
            <Shield className="w-3 h-3" />
            <span>Slave (Server)</span>
          </button>
        </div>

        <div className="h-4 w-px bg-slate-700/80 mx-0.5" />

        {/* --- MASTER CONTROLS --- */}
        {role === 'master' && (
          <>
            {isConnected ? (
              <button
                onClick={onDisconnectClick}
                className="flex items-center space-x-1.5 px-3 py-1 rounded bg-rose-600/20 text-rose-300 border border-rose-600/40 hover:bg-rose-600/30 transition-all font-medium"
                title="Disconnect active connection"
              >
                <Unplug className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                onClick={onConnectClick}
                className="flex items-center space-x-1.5 px-3 py-1 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-600/40 hover:bg-cyan-600/30 transition-all font-medium"
                title="Connect (F3)"
              >
                <Plug className="w-3.5 h-3.5" />
                <span>Connect (F3)</span>
              </button>
            )}

            {/* Setup Definition (F8) */}
            <button
              onClick={onDefinitionClick}
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
              title="Setup Slave ID, Function Code, Address and Length (F8)"
            >
              <Settings className="w-3.5 h-3.5 text-cyan-400" />
              <span>Definition (F8)</span>
            </button>

            {/* Polling Play/Pause */}
            <button
              onClick={onTogglePoll}
              disabled={!isConnected}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded border transition-all ${
                !isConnected
                  ? 'opacity-40 cursor-not-allowed bg-slate-800/40 border-slate-800 text-slate-500'
                  : isPolling
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              }`}
              title={isPolling ? 'Pause continuous polling' : 'Start continuous polling'}
            >
              {isPolling ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPolling ? 'Pause' : 'Poll'}</span>
            </button>

            {/* Read Once */}
            <button
              onClick={onReadOnce}
              disabled={!isConnected || isPolling}
              className={`flex items-center space-x-1 px-2 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all ${
                !isConnected || isPolling ? 'opacity-40 cursor-not-allowed' : ''
              }`}
              title="Read single poll frame (F7)"
            >
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>Read Once</span>
            </button>

            {/* Reset Counters */}
            <button
              onClick={onClearCounters}
              className="flex items-center space-x-1 px-2 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              title="Clear Tx / Error counters"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span>Clear Counters</span>
            </button>
          </>
        )}

        {/* --- SLAVE CONTROLS --- */}
        {role === 'slave' && (
          <>
            {/* Slave Server Listen / Stop */}
            <button
              onClick={onToggleSlaveServer}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded font-medium border transition-all ${
                isListening
                  ? 'bg-rose-600/20 text-rose-300 border-rose-600/40 hover:bg-rose-600/30'
                  : 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40 hover:bg-emerald-600/30'
              }`}
              title={isListening ? 'Dừng lắng nghe kết nối' : 'Bắt đầu lắng nghe kết nối (Server)'}
            >
              {isListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isListening ? 'Stop Server' : 'Listen Server'}</span>
            </button>

            {/* Setup Slave Config */}
            <button
              onClick={onOpenSlaveModal}
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
              title="Cài đặt cổng kết nối, Slave ID và bộ mô phỏng"
            >
              <Server className="w-3.5 h-3.5 text-amber-400" />
              <span>Slave Setup</span>
            </button>

            <div className="h-4 w-px bg-slate-700/80 mx-1" />

            {/* Memory Table Selector: 0x, 1x, 3x, 4x */}
            <div className="flex items-center space-x-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-700/80">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400 text-[11px] font-medium">Memory Table:</span>
              <select
                value={slaveTable}
                onChange={(e) => onTableChange(e.target.value as SlaveTable)}
                className="bg-transparent text-amber-300 text-xs focus:outline-none cursor-pointer pr-1 font-semibold"
              >
                <option value="holding" className="bg-slate-900 text-slate-100">4x Holding Registers (FC 03, 06, 16)</option>
                <option value="input" className="bg-slate-900 text-slate-100">3x Input Registers (FC 04)</option>
                <option value="coils" className="bg-slate-900 text-slate-100">0x Discrete Coils (FC 01, 05, 15)</option>
                <option value="discrete" className="bg-slate-900 text-slate-100">1x Discrete Inputs (FC 02)</option>
              </select>
            </div>
          </>
        )}

        <div className="h-4 w-px bg-slate-700/80 mx-1" />

        {/* Format Selector */}
        <div className="flex items-center space-x-1.5 bg-slate-950 px-2 py-0.5 rounded border border-slate-700/80">
          <Binary className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400 text-[11px] font-medium">Format:</span>
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as DataFormat)}
            className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-1"
          >
            <option value="signed16" className="bg-slate-900 text-slate-100">Signed 16-bit</option>
            <option value="unsigned16" className="bg-slate-900 text-slate-100">Unsigned 16-bit</option>
            <option value="hex16" className="bg-slate-900 text-slate-100">Hexadecimal (0x...)</option>
            <option value="bin16" className="bg-slate-900 text-slate-100">Binary (16-bit)</option>
            <option value="float_abcd" className="bg-slate-900 text-slate-100">Float 32 (ABCD - Big Endian)</option>
            <option value="float_cdab" className="bg-slate-900 text-slate-100">Float 32 (CDAB - Word Swap)</option>
            <option value="float_badc" className="bg-slate-900 text-slate-100">Float 32 (BADC - Byte Swap)</option>
            <option value="float_dcba" className="bg-slate-900 text-slate-100">Float 32 (DCBA - Little Endian)</option>
            <option value="long_abcd" className="bg-slate-900 text-slate-100">Long 32 (ABCD)</option>
            <option value="long_cdab" className="bg-slate-900 text-slate-100">Long 32 (CDAB)</option>
            <option value="uint32_abcd" className="bg-slate-900 text-slate-100">UInt 32 (ABCD)</option>
            <option value="uint32_cdab" className="bg-slate-900 text-slate-100">UInt 32 (CDAB)</option>
            <option value="water_48_be" className="bg-slate-900 text-cyan-300 font-semibold">🌊 Đồng Hồ Nước 48-bit (BE)</option>
            <option value="water_48_le" className="bg-slate-900 text-cyan-300 font-semibold">🌊 Đồng Hồ Nước 48-bit (LE)</option>
            <option value="water_48_bcd" className="bg-slate-900 text-pink-300 font-semibold">🌊 Đồng Hồ Nước 48-bit BCD</option>
            <option value="int64" className="bg-slate-900 text-slate-100">Int 64 (4 Regs)</option>
            <option value="uint64" className="bg-slate-900 text-slate-100">UInt 64 (4 Regs)</option>
            <option value="ascii" className="bg-slate-900 text-slate-100">ASCII Text</option>
          </select>
        </div>
      </div>

      {/* Right tool group */}
      <div className="flex items-center space-x-1.5">
        {/* Scanner Trigger */}
        {onOpenScanner && (
          <button
            onClick={onOpenScanner}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-gradient-to-r from-cyan-600/30 to-blue-600/30 hover:from-cyan-600/50 hover:to-blue-600/50 text-cyan-300 border border-cyan-500/50 shadow-sm transition-all font-semibold"
            title="Mở Bộ Quét & Thám Tử Modbus: Dò tìm Slave ID, tốc độ Baudrate, và giải mã thanh ghi đa cột"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span>Bộ Quét (Scanner)</span>
          </button>
        )}

        {/* Mobile Remote Live Monitor Trigger */}
        {onOpenMobileRemote && (
          <button
            onClick={onOpenMobileRemote}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-gradient-to-r from-purple-950/70 to-indigo-950/70 hover:from-purple-900 hover:to-indigo-900 text-purple-300 border border-purple-500/50 shadow-sm transition-all font-semibold"
            title="Xem Modbus trực tiếp trên điện thoại qua Wi-Fi hoặc 4G Tailscale VPN (F9)"
          >
            <Smartphone className="w-3.5 h-3.5 text-purple-400" />
            <span>Xem Trên ĐT (F9)</span>
          </button>
        )}

        {/* New Tab */}
        <button
          onClick={onNewTab}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all font-medium"
          title="Thêm Tab / Sheet làm việc mới"
        >

          <Plus className="w-3.5 h-3.5 text-cyan-400" />
          <span>New Sheet</span>
        </button>

        {/* Split View Toggle */}
        {onToggleSplitView && (
          <button
            onClick={onToggleSplitView}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded border transition-all ${
              isSplitView
                ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/60 shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Xem 2 Sheet / Cửa sổ song song để so sánh đối chiếu"
          >
            <Columns2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isSplitView ? 'Đóng Split' : 'Split View'}</span>
          </button>
        )}

        {/* Trend Chart Drawer Toggle (when active target exists) */}
        {hasActiveChart && onToggleChart && (
          <button
            onClick={onToggleChart}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-500/50 shadow-sm transition-all"
            title="Bật/Tắt khung hiển thị Biểu đồ xu hướng (Trend Chart)"
          >
            <LineChart className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>Biểu đồ 📈</span>
          </button>
        )}

        {/* Traffic Box Toggle */}
        <button
          onClick={onToggleTraffic}
          className={`flex items-center space-x-1 px-2 py-1 rounded border transition-all ${
            showTraffic
              ? 'bg-cyan-950/60 text-cyan-300 border-cyan-700/60'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}
          title="Toggle Hex Communication Traffic Log"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Traffic Log</span>
        </button>

        {/* Protocol Analyzer & Bus Health Modal Trigger */}
        {onOpenProtocolAnalyzer && (
          <button
            onClick={onOpenProtocolAnalyzer}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-cyan-950/70 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-500/50 hover:border-cyan-400 transition-all font-medium shadow-sm"
            title="Mở Protocol Analyzer & Bus Health (F10)"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Analyzer</span>
          </button>
        )}

        {onOpenAnalyzerStudio && (
          <button
            onClick={onOpenAnalyzerStudio}
            className="flex items-center space-x-1.5 rounded border border-emerald-400/40 bg-emerald-300/10 px-2.5 py-1 font-semibold text-emerald-200 transition-all hover:bg-emerald-300/20"
            title="Mở giao diện Analyzer Studio mới (F11)"
          >
            <Zap className="h-3.5 w-3.5 text-emerald-300" />
            <span>Studio</span>
          </button>
        )}

        {onOpenWorkspaceStudio && (
          <button
            onClick={onOpenWorkspaceStudio}
            className="flex items-center space-x-1.5 rounded border border-violet-400/40 bg-violet-300/10 px-2.5 py-1 font-semibold text-violet-200 transition-all hover:bg-violet-300/20"
            title="Chuyển toàn bộ ứng dụng sang giao diện Studio"
          >
            <PanelsTopLeft className="h-3.5 w-3.5 text-violet-300" />
            <span>UI mới</span>
          </button>
        )}

        {/* User Guide Modal Trigger */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 hover:border-cyan-500/50 transition-all font-medium"
            title="Mở hướng dẫn sử dụng và cẩm nang vận hành (F1)"
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Hướng Dẫn</span>
          </button>
        )}
      </div>
    </div>
  );
};
