import React, { useRef } from 'react';
import {
  X,
  Layers,
  Download,
  Upload,
  Cpu,
  CheckCircle,
  FileJson,
  Sparkles,
} from 'lucide-react';
import { TabSession } from '../types/modbus';
import {
  DEVICE_TEMPLATES,
  DeviceTemplate,
  exportDeviceProfileToFile,
  importDeviceProfileFromFile,
} from '../utils/projectStorage';

interface DeviceTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabSession;
  onApplyTemplate: (templateTab: Partial<TabSession>, replaceTab: boolean) => void;
  onImportProfile: (importedTab: Partial<TabSession>) => void;
}

export const DeviceTemplatesModal: React.FC<DeviceTemplatesModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  onApplyTemplate,
  onImportProfile,
}) => {
  const profileFileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const tabData = await importDeviceProfileFromFile(file);
      onImportProfile(tabData);
      onClose();
    } catch (err) {
      alert('Không thể đọc file Profile: ' + (err as Error).message);
    } finally {
      if (profileFileInputRef.current) profileFileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Hidden File Input for Profile Import */}
        <input
          ref={profileFileInputRef}
          type="file"
          accept=".json,.nxmodbus"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 rounded-xl border border-cyan-500/30 text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                Thư Viện Mẫu Thiết Bị & Quản Lý Profile (Device Templates)
              </h2>
              <p className="text-xs text-slate-400">
                Cài mềm cấu hình, nút khiển nhanh mũi tên/ON-OFF, lưu và chia sẻ file JSON
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Share / Export / Import Toolbar */}
        <div className="flex flex-wrap items-center justify-between px-6 py-3 bg-slate-950/50 border-b border-slate-800/80 gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>
              Tab đang chọn: <strong className="text-white">{activeTab.title}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => exportDeviceProfileToFile(activeTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition shadow-sm"
              title="Xuất tab hiện tại thành file .profile.json để lưu trữ hoặc gửi cho người khác"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Xuất Profile JSON</span>
            </button>

            <button
              onClick={() => profileFileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg text-xs font-semibold border border-indigo-500/40 transition shadow-sm"
              title="Nạp file profile từ máy tính"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Nhập File Profile</span>
            </button>
          </div>
        </div>

        {/* Templates List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Mẫu thiết bị công nghiệp tích hợp sẵn</span>
            </span>
            <span className="text-[11px] text-slate-500">
              Nhấp "Áp dụng" để chuyển tab hiện tại hoặc tạo tab mới theo mẫu
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DEVICE_TEMPLATES.map((tpl: DeviceTemplate) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between p-4 rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-cyan-500/40 hover:bg-slate-900/90 transition group"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                      {tpl.category}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      FC0{tpl.tab.definition?.function_code || 3} · {tpl.tab.definition?.quantity || 10} điểm
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-100 group-hover:text-cyan-300 transition">
                    {tpl.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {tpl.description}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-800/60">
                  <button
                    onClick={() => {
                      onApplyTemplate(tpl.tab, false);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition"
                  >
                    + Tạo Tab Mới
                  </button>
                  <button
                    onClick={() => {
                      onApplyTemplate(tpl.tab, true);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow-sm flex items-center gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Áp Dụng Vào Tab Này</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-emerald-400" />
            <span>Mọi cấu hình ô, công tắc và nút bấm đều được lưu tự động và chia sẻ qua file JSON.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
