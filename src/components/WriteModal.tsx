import React, { useState, useEffect } from 'react';
import { X, Edit3, Send } from 'lucide-react';
import { RegisterRow } from '../types/modbus';

interface WriteModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: RegisterRow | null;
  slaveId: number;
  isCoil: boolean;
  onWriteRegister: (slaveId: number, address: number, value: number) => Promise<void>;
  onWriteCoil: (slaveId: number, address: number, value: boolean) => Promise<void>;
}

export const WriteModal: React.FC<WriteModalProps> = ({
  isOpen,
  onClose,
  row,
  slaveId,
  isCoil,
  onWriteRegister,
  onWriteCoil,
}) => {
  const [valString, setValString] = useState<string>('');
  const [coilVal, setCoilVal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      if (isCoil) {
        setCoilVal(Boolean(row.rawValue));
      } else {
        setValString(String(row.rawValue));
      }
      setErrorMsg(null);
    }
  }, [row, isCoil, isOpen]);

  if (!isOpen || !row) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (isCoil) {
        await onWriteCoil(slaveId, row.address, coilVal);
      } else {
        let numVal = 0;
        const trimmed = valString.trim();
        if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
          numVal = parseInt(trimmed, 16);
        } else {
          numVal = parseInt(trimmed, 10);
        }

        if (isNaN(numVal) || numVal < 0 || numVal > 65535) {
          throw new Error('Giá trị thanh ghi không hợp lệ (Phải từ 0 đến 65535 hoặc 0x0000 - 0xFFFF)');
        }

        await onWriteRegister(slaveId, row.address, numVal);
      }
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(String(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none">
      <div className="w-[420px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden font-sans text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/90 border-b border-slate-700 text-slate-100">
          <div className="flex items-center space-x-2 font-semibold">
            <Edit3 className="w-4 h-4 text-cyan-400" />
            <span>
              {isCoil
                ? 'Write Single Coil (FC 05)'
                : 'Write Single Register (FC 06)'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {errorMsg && (
            <div className="p-2.5 rounded bg-rose-950/60 border border-rose-700/60 text-rose-300 text-[11px]">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-slate-400">
            <div>
              <span className="block text-[11px]">Slave ID:</span>
              <span className="font-mono text-slate-200 text-sm font-bold">{slaveId}</span>
            </div>
            <div>
              <span className="block text-[11px]">Address:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-cyan-400 text-sm font-bold">
                  {row.displayAddress}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  (Dec: <span className="text-cyan-300 font-semibold">{row.address}</span> | Hex: <span className="text-purple-400 font-semibold">0x{(row.address & 0xffff).toString(16).toUpperCase().padStart(4, '0')}</span>)
                </span>
              </div>
            </div>
          </div>

          {row.alias && (
            <div>
              <span className="block text-slate-400 text-[11px]">Tên biến:</span>
              <span className="text-slate-200 font-medium">{row.alias}</span>
            </div>
          )}

          {isCoil ? (
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Trạng thái Coil mới:
              </label>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setCoilVal(true)}
                  className={`flex-1 py-2 rounded font-bold border transition-colors ${
                    coilVal
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-900/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  ON (1 / True)
                </button>
                <button
                  type="button"
                  onClick={() => setCoilVal(false)}
                  className={`flex-1 py-2 rounded font-bold border transition-colors ${
                    !coilVal
                      ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-900/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  OFF (0 / False)
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Giá trị ghi mới (Decimal hoặc Hex):
              </label>
              <input
                type="text"
                autoFocus
                value={valString}
                placeholder="Nhập giá trị (ví dụ: 250 hoặc 0x00FA)"
                onChange={(e) => setValString(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-sm"
                required
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Phạm vi 16-bit: 0 đến 65535 (hoặc 0x0000 đến 0xFFFF)
              </span>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end pt-3 border-t border-slate-800 space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-900/30 transition-colors flex items-center space-x-1 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Đang gửi...' : 'Ghi Giá Trị'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
