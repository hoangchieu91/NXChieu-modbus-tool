import React, { useState } from 'react';
import {
  Grid3X3,
  ScanSearch,
  LineChart,
  Network,
  Server,
  Smartphone,
  HelpCircle,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Save,
  Plus,
  Download,
  Sparkles,
  Terminal,
  Copy,
  ArrowRightLeft,
  Database,
  FileCode2,
} from 'lucide-react';

export type WorkspaceView =
  | 'registers'
  | 'scanner'
  | 'charts'
  | 'analyzer'
  | 'slave'
  | 'rawserial'
  | 'gateway'
  | 'datalogger'
  | 'macro';

interface SidebarDockProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onOpenMobileRemote?: () => void;
  onOpenDiagnostics?: () => void;
  onOpenHelp?: () => void;
  onOpenNewTab?: () => void;
  onSaveProject?: () => void;
  onOpenProject?: () => void;
  onExportCSV?: () => void;
  onOpenTemplates?: () => void;
  onOpenNewInstance?: () => void;
  isPolling?: boolean;
  slaveRunning?: boolean;
}

export const SidebarDock: React.FC<SidebarDockProps> = ({
  activeView,
  onSelectView,
  onOpenMobileRemote,
  onOpenDiagnostics,
  onOpenHelp,
  onOpenNewTab,
  onSaveProject,
  onOpenProject,
  onExportCSV,
  onOpenTemplates,
  onOpenNewInstance,
  isPolling = false,
  slaveRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_expanded') === 'true';
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_expanded', String(next));
      return next;
    });
  };

  const navItems: {
    id: WorkspaceView;
    label: string;
    description: string;
    icon: React.ElementType;
    badge?: string;
    badgeColor?: string;
  }[] = [
    {
      id: 'registers',
      label: 'Bảng dữ liệu',
      description: 'Đọc/ghi thanh ghi & quan sát',
      icon: Grid3X3,
      badge: isPolling ? 'POLL' : undefined,
      badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    },
    {
      id: 'scanner',
      label: 'Dò quét thiết bị',
      description: 'Slave ID, Baudrate & Registers',
      icon: ScanSearch,
    },
    {
      id: 'charts',
      label: 'Biểu đồ sóng',
      description: 'Trend realtime đa kênh',
      icon: LineChart,
    },
    {
      id: 'analyzer',
      label: 'Phân tích gói',
      description: 'Protocol Sniffer & Timing',
      icon: Network,
    },
    {
      id: 'slave',
      label: 'Mô phỏng Slave',
      description: 'Bộ nhớ ảo & Trình phát sinh',
      icon: Server,
      badge: slaveRunning ? 'ACTIVE' : undefined,
      badgeColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
    },
    {
      id: 'rawserial',
      label: 'Test TTL / UART',
      description: 'Terminal thô, Hex & DTR/RTS',
      icon: Terminal,
    },
    {
      id: 'gateway',
      label: 'Cầu nối Gateway',
      description: 'Chuyển đổi TCP ↔ RTU',
      icon: ArrowRightLeft,
    },
    {
      id: 'datalogger',
      label: 'Nhật ký ngâm (DB)',
      description: 'SQLite Datalogger qua đêm',
      icon: Database,
    },
    {
      id: 'macro',
      label: 'Kịch bản tự động',
      description: 'Auto-Scripting & Runner',
      icon: FileCode2,
    },
  ];

  return (
    <aside
      className={`h-full bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between select-none transition-all duration-200 z-20 shrink-0 ${
        isExpanded ? 'w-56' : 'w-16'
      }`}
    >
      {/* Top Section: Navigation Items */}
      <div className="flex flex-col gap-1 p-2">
        {/* Quick New Tab Button */}
        {onOpenNewTab && (
          <button
            onClick={onOpenNewTab}
            title={isExpanded ? 'Mở thêm tab phiên mới' : 'Mở tab mới'}
            className="flex items-center gap-3 w-full px-2.5 py-2 mb-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white transition group"
          >
            <div className="p-1 rounded bg-indigo-500/30 text-indigo-200 group-hover:scale-105 transition">
              <Plus className="w-4 h-4" />
            </div>
            {isExpanded && (
              <div className="text-left overflow-hidden">
                <div className="text-xs font-semibold leading-tight">Thêm Tab mới</div>
                <div className="text-[10px] text-indigo-400/80 truncate">Phiên Modbus mới</div>
              </div>
            )}
          </button>
        )}

        {/* View Switchers */}
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectView(item.id)}
                title={!isExpanded ? `${item.label} - ${item.description}` : undefined}
                className={`relative flex items-center gap-3 w-full px-2.5 py-2.5 rounded-lg text-xs font-medium transition ${
                  isActive
                    ? 'bg-slate-800 text-white font-semibold shadow-sm border border-slate-700/80'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                }`}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-cyan-400 rounded-r" />
                )}

                <Icon
                  className={`w-5 h-5 shrink-0 transition ${
                    isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-300'
                  }`}
                />

                {isExpanded && (
                  <div className="flex-1 text-left overflow-hidden leading-tight">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded border font-mono font-bold ${item.badgeColor}`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>
                )}

                {!isExpanded && item.badge && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Section: Utility Actions & Dock Toggle */}
      <div className="flex flex-col gap-1 p-2 border-t border-slate-800/80 bg-slate-950/60">
        {/* Device Templates & Profiles */}
        {onOpenTemplates && (
          <button
            onClick={onOpenTemplates}
            title={!isExpanded ? 'Thư viện mẫu thiết bị & Quản lý Profile JSON' : undefined}
            className="flex items-center gap-3 w-full px-2.5 py-2 mb-1 rounded-lg text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-slate-900 border border-cyan-500/30 bg-cyan-950/20 transition group"
          >
            <Sparkles className="w-4 h-4 shrink-0 text-cyan-400 group-hover:scale-110 transition" />
            {isExpanded && <span className="truncate font-bold">Mẫu thiết bị (Templates)</span>}
          </button>
        )}

        {/* New Parallel Instance */}
        {onOpenNewInstance && (
          <button
            onClick={onOpenNewInstance}
            title={!isExpanded ? 'Mở thêm cửa sổ độc lập mới để test song song (New Instance)' : undefined}
            className="flex items-center gap-3 w-full px-2.5 py-2 mb-1 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-slate-900 border border-emerald-500/30 bg-emerald-950/20 transition group"
          >
            <Copy className="w-4 h-4 shrink-0 text-emerald-400 group-hover:scale-110 transition" />
            {isExpanded && <span className="truncate font-bold">Cửa Sổ Mới (Song Song)</span>}
          </button>
        )}

        {/* Project Actions (Save / Open / Export) */}
        {(onSaveProject || onOpenProject || onExportCSV) && (
          <div className={`grid gap-1 mb-1 ${onExportCSV ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {onOpenProject && (
              <button
                onClick={onOpenProject}
                title="Mở tệp cấu hình Project"
                className="flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition text-[11px]"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {isExpanded && <span className="truncate">Mở</span>}
              </button>
            )}
            {onSaveProject && (
              <button
                onClick={onSaveProject}
                title="Lưu cấu hình Project"
                className="flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition text-[11px]"
              >
                <Save className="w-3.5 h-3.5" />
                {isExpanded && <span className="truncate">Lưu</span>}
              </button>
            )}
            {onExportCSV && (
              <button
                onClick={onExportCSV}
                title="Xuất bảng dữ liệu hiện tại ra CSV"
                className="flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition text-[11px]"
              >
                <Download className="w-3.5 h-3.5" />
                {isExpanded && <span className="truncate">CSV</span>}
              </button>
            )}
          </div>
        )}

        {/* Mobile Remote */}
        {onOpenMobileRemote && (
          <button
            onClick={onOpenMobileRemote}
            title={!isExpanded ? 'Điều khiển Web Mobile & QR Code' : undefined}
            className="flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition"
          >
            <Smartphone className="w-4 h-4 shrink-0 text-cyan-400" />
            {isExpanded && <span className="truncate">Web Mobile HMI</span>}
          </button>
        )}

        {/* Diagnostics */}
        {onOpenDiagnostics && (
          <button
            onClick={onOpenDiagnostics}
            title={!isExpanded ? 'Kiểm toán hệ thống (Diagnostics)' : undefined}
            className="flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition"
          >
            <Stethoscope className="w-4 h-4 shrink-0 text-amber-400" />
            {isExpanded && <span className="truncate">Chẩn đoán Core</span>}
          </button>
        )}

        {/* Help */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            title={!isExpanded ? 'Hướng dẫn & Phím tắt (F1)' : undefined}
            className="flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition"
          >
            <HelpCircle className="w-4 h-4 shrink-0 text-slate-400" />
            {isExpanded && <span className="truncate">Hướng dẫn (F1)</span>}
          </button>
        )}

        {/* Dock Expand / Collapse Toggle Button */}
        <button
          onClick={toggleExpanded}
          className="flex items-center justify-center w-full py-2 mt-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-900 transition border-t border-slate-800/60"
          title={isExpanded ? 'Thu gọn thanh bên' : 'Mở rộng thanh bên'}
        >
          {isExpanded ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <ChevronLeft className="w-4 h-4" />
              <span>Thu gọn Sidebar</span>
            </div>
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
};
