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
  Sliders,
} from 'lucide-react';
import { DataFormat, SessionRole, SlaveTable, SlaveConfig } from '../types/modbus';

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
  slaveConfig?: SlaveConfig;
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
  showInspector?: boolean;
  onToggleInspector?: () => void;
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
  slaveConfig,
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
  showInspector,
  onToggleInspector,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 text-xs gap-2 select-none">
      {/* LEFT SECTION: 3 Standard Logical Groups */}
      <div className="flex flex-wrap items-center gap-2">
        {/* GROUP 1: ROLE & CONNECTION */}
        <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800 shadow-sm gap-1">
          {/* Role Pill */}
          <div className="flex items-center bg-slate-900 p-0.5 rounded-md border border-slate-700/60">
            <button
              onClick={() => onRoleChange('master')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                role === 'master'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Chế độ Modbus Master (Poll): Đọc/Ghi dữ liệu từ các thiết bị ngoại vi"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Master</span>
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
              <Shield className="w-3.5 h-3.5" />
              <span>Slave</span>
            </button>
          </div>

          {/* Master Connection & Definition */}
          {role === 'master' ? (
            <>
              {isConnected ? (
                <button
                  onClick={onDisconnectClick}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-all font-semibold"
                  title="Ngắt kết nối hiện tại (F3)"
                >
                  <Unplug className="w-3.5 h-3.5 text-rose-400" />
                  <span>Disconnect</span>
                  <span className="text-[9px] bg-rose-950/80 px-1 py-0.2 rounded border border-rose-500/40 text-rose-300">F3</span>
                </button>
              ) : (
                <button
                  onClick={onConnectClick}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-all font-semibold"
                  title="Mở hộp thoại kết nối Modbus (F3)"
                >
                  <Plug className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Connect</span>
                  <span className="text-[9px] bg-cyan-950/80 px-1 py-0.2 rounded border border-cyan-500/40 text-cyan-300">F3</span>
                </button>
              )}

              <button
                onClick={onDefinitionClick}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all font-medium"
                title="Cài đặt thông số quét: Slave ID, Function Code, Address, Length (F8)"
              >
                <Settings className="w-3.5 h-3.5 text-cyan-400" />
                <span>Definition</span>
                <span className="text-[9px] bg-slate-900 px-1 py-0.2 rounded border border-slate-600 text-slate-400">F8</span>
              </button>
            </>
          ) : (
            /* Slave Server Control & Setup */
            <>
              <button
                onClick={onToggleSlaveServer}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border font-semibold transition-all ${
                  isListening
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                }`}
                title={isListening ? 'Dừng lắng nghe kết nối' : 'Khởi chạy Slave Server'}
              >
                {isListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isListening ? 'Stop Server' : 'Listen Server'}</span>
              </button>

              <button
                onClick={onOpenSlaveModal}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all font-medium"
                title="Cài đặt cổng Modbus Slave và thông số mô phỏng"
              >
                <Server className="w-3.5 h-3.5 text-amber-400" />
                <span>Slave Setup</span>
              </button>

              {/* Memory Table Picker */}
              <div className="flex items-center space-x-1 bg-slate-900 px-2 py-0.5 rounded border border-slate-700/80">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-400 text-[11px]">Vùng nhớ:</span>
                <select
                  value={slaveTable}
                  onChange={(e) => onTableChange(e.target.value as SlaveTable)}
                  className="bg-transparent text-amber-300 text-xs focus:outline-none cursor-pointer font-semibold pr-1"
                >
                  <option value="holding" className="bg-slate-900 text-slate-100">4x Holding (FC03/06/16)</option>
                  <option value="input" className="bg-slate-900 text-slate-100">3x Input (FC04)</option>
                  <option value="coils" className="bg-slate-900 text-slate-100">0x Coils (FC01/05/15)</option>
                  <option value="discrete" className="bg-slate-900 text-slate-100">1x Discrete (FC02)</option>
                </select>
              </div>

              {/* Multi-Slave Range Indicator */}
              {slaveConfig?.slave_id_end && slaveConfig.slave_id_end > (slaveConfig.slave_id || 1) && (
                <div
                  className="flex items-center space-x-1 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[11px] font-semibold cursor-pointer"
                  onClick={onOpenSlaveModal}
                  title="Đang giả lập dải nhiều Slave IDs trên cùng 1 cổng COM"
                >
                  <Shield className="w-3 h-3 text-amber-400" />
                  <span>Slave {slaveConfig.slave_id}..{slaveConfig.slave_id_end} ({slaveConfig.slave_id_end - (slaveConfig.slave_id || 1) + 1} Slaves)</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* GROUP 2: POLLING & SCAN ACTIONS (MASTER ONLY) */}
        {role === 'master' && (
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800 shadow-sm gap-1">
            <button
              onClick={onTogglePoll}
              disabled={!isConnected}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border font-semibold transition-all ${
                !isConnected
                  ? 'opacity-40 cursor-not-allowed bg-slate-800/40 border-slate-800 text-slate-500'
                  : isPolling
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              }`}
              title={isPolling ? 'Tạm dừng polling liên tục' : 'Bắt đầu quét polling liên tục'}
            >
              {isPolling ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPolling ? 'Pause' : 'Poll'}</span>
            </button>

            <button
              onClick={onReadOnce}
              disabled={!isConnected || isPolling}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all font-medium ${
                !isConnected || isPolling ? 'opacity-40 cursor-not-allowed' : ''
              }`}
              title="Đọc một khung dữ liệu duy nhất (F7)"
            >
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>Read Once</span>
              <span className="text-[9px] bg-slate-900 px-1 py-0.2 rounded border border-slate-600 text-slate-400">F7</span>
            </button>

            <button
              onClick={onClearCounters}
              className="flex items-center space-x-1 px-2 py-1 rounded-md border border-slate-700/60 bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-all"
              title="Đặt lại bộ đếm Tx và Error về 0"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span className="text-[11px]">Clear</span>
            </button>
          </div>
        )}

        {/* GROUP 3: DISPLAY FORMAT SELECTOR */}
        <div className="flex items-center bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800 shadow-sm gap-1.5">
          <Binary className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400 text-[11px] font-medium">Format:</span>
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as DataFormat)}
            className="bg-slate-900 border border-slate-700/70 rounded px-1.5 py-0.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="unsigned16" className="bg-slate-900 text-slate-100">Unsigned 16-bit (0..65535)</option>
            <option value="signed16" className="bg-slate-900 text-slate-100">Signed 16-bit (-32768..32767)</option>
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

      {/* RIGHT SECTION: Professional Tools & View Panes */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Scanner Tool */}
        {onOpenScanner && (
          <button
            onClick={onOpenScanner}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-cyan-950/70 to-blue-950/70 hover:from-cyan-900 hover:to-blue-900 text-cyan-300 border border-cyan-500/40 shadow-sm transition-all font-semibold"
            title="Mở Bộ Quét & Thám Tử Modbus (F4): Tìm kiếm Unit ID, Baudrate và vùng thanh ghi"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span>Scanner</span>
            <span className="text-[9px] bg-cyan-950 px-1 py-0.2 rounded border border-cyan-600/40 text-cyan-400">F4</span>
          </button>
        )}

        {/* Mobile Remote Monitoring */}
        {onOpenMobileRemote && (
          <button
            onClick={onOpenMobileRemote}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-950/70 to-indigo-950/70 hover:from-purple-900 hover:to-indigo-900 text-purple-300 border border-purple-500/40 shadow-sm transition-all font-semibold"
            title="Mở máy chủ giám sát từ xa trên điện thoại qua Wi-Fi / VPN (F9)"
          >
            <Smartphone className="w-3.5 h-3.5 text-purple-400" />
            <span>Mobile</span>
            <span className="text-[9px] bg-purple-950 px-1 py-0.2 rounded border border-purple-600/40 text-purple-400">F9</span>
          </button>
        )}

        {/* Protocol Analyzer & Bus Health */}
        {onOpenProtocolAnalyzer && (
          <button
            onClick={onOpenProtocolAnalyzer}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 shadow-sm transition-all font-semibold"
            title="Mở Modbus Protocol Analyzer & Chẩn đoán sức khỏe đường truyền Bus (F10)"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Analyzer</span>
            <span className="text-[9px] bg-emerald-950 px-1 py-0.2 rounded border border-emerald-600/40 text-emerald-400">F10</span>
          </button>
        )}

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* Split View Toggle */}
        {onToggleSplitView && (
          <button
            onClick={onToggleSplitView}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border transition-all ${
              isSplitView
                ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/60 shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Bật/Tắt chế độ xem song song 2 Sheet đối chiếu"
          >
            <Columns2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isSplitView ? 'Đóng Split' : 'Split View'}</span>
          </button>
        )}

        {/* Trend Chart Drawer Toggle */}
        {onToggleChart && (
          <button
            onClick={onToggleChart}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border transition-all ${
              hasActiveChart
                ? 'bg-cyan-950/70 text-cyan-300 border-cyan-500/60 shadow-sm'
                : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
            }`}
            title="Bật/Tắt khung hiển thị Biểu đồ xu hướng đa kênh (Trend Chart)"
          >
            <LineChart className={`w-3.5 h-3.5 ${hasActiveChart ? 'text-cyan-400 animate-pulse' : 'text-slate-400'}`} />
            <span>Biểu đồ</span>
          </button>
        )}

        {/* Quick Inspector Panel Toggle */}
        {onToggleInspector && (
          <button
            onClick={onToggleInspector}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border transition-all ${
              showInspector
                ? 'bg-amber-950/60 text-amber-300 border-amber-600/60 shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Bật/Tắt thanh Inspector bên phải để xem nhanh và ghi nhanh thanh ghi"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Inspector</span>
          </button>
        )}

        {/* Traffic Box Toggle */}
        <button
          onClick={onToggleTraffic}
          className={`flex items-center space-x-1 px-2 py-1 rounded-md border transition-all ${
            showTraffic
              ? 'bg-cyan-950/60 text-cyan-300 border-cyan-700/60'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
          }`}
          title="Bật/Tắt khung Traffic Log khung truyền Raw Hex"
        >
          <Terminal className="w-3.5 h-3.5 text-slate-400" />
          <span>Traffic</span>
        </button>

        {/* New Tab */}
        <button
          onClick={onNewTab}
          className="flex items-center space-x-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all font-medium"
          title="Thêm Tab / Sheet làm việc mới"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400" />
          <span>Sheet</span>
        </button>

        {/* Help Modal */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="flex items-center p-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 border border-slate-700 transition-all"
            title="Hướng dẫn sử dụng & Phím tắt (F1)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
