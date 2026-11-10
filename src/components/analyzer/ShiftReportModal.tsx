import React from 'react';
import { Download, FileText, X } from 'lucide-react';
import { ShiftReportOptions } from '../../types/modbus';

interface ShiftReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportOpts: ShiftReportOptions;
  onChangeReportOpts: (opts: ShiftReportOptions) => void;
  onExportReport: () => void;
}

export const ShiftReportModal: React.FC<ShiftReportModalProps> = ({
  isOpen,
  onClose,
  reportOpts,
  onChangeReportOpts,
  onExportReport,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-cyan-900/60 bg-[#09131d] shadow-2xl overflow-hidden">
        <div className="flex h-12 items-center justify-between border-b border-slate-800 bg-[#0c1824] px-5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Báo cáo Sức khỏe Modbus (HTML Report)
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <div>
            <label className="text-slate-400 font-semibold block mb-1">Tiêu đề báo cáo</label>
            <input
              value={reportOpts.title}
              onChange={(e) => onChangeReportOpts({ ...reportOpts, title: e.target.value })}
              className="w-full h-8 border border-slate-700 bg-slate-950 px-2.5 text-slate-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 font-semibold block mb-1">Kỹ sư / Vận hành viên</label>
              <input
                value={reportOpts.operator}
                onChange={(e) => onChangeReportOpts({ ...reportOpts, operator: e.target.value })}
                className="w-full h-8 border border-slate-700 bg-slate-950 px-2.5 text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 font-semibold block mb-1">Ca trực</label>
              <input
                value={reportOpts.shift}
                onChange={(e) => onChangeReportOpts({ ...reportOpts, shift: e.target.value })}
                className="w-full h-8 border border-slate-700 bg-slate-950 px-2.5 text-slate-200"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-400 font-semibold block mb-1">Ghi chú / Khu vực / Trạm điện</label>
            <textarea
              rows={3}
              value={reportOpts.notes}
              onChange={(e) => onChangeReportOpts({ ...reportOpts, notes: e.target.value })}
              className="w-full border border-slate-700 bg-slate-950 p-2 text-slate-200"
            />
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
            <span className="text-[10px] text-slate-500">
              Định dạng HTML độc lập, tối ưu in ấn A4 (Ctrl+P / Lưu PDF)
            </span>
            <button
              onClick={onExportReport}
              className="flex h-9 items-center gap-1.5 rounded bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-500"
            >
              <Download className="h-4 w-4" /> Xuất Báo Cáo HTML
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
