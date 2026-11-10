import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Cpu,
  Layers,
  Radio,
  Zap,
} from 'lucide-react';
import { TabSession, SerialPortDetail } from '../types/modbus';
import { listSerialPorts } from '../services/backend';
import { SlaveIdScannerTab } from './scanner/SlaveIdScannerTab';
import { BaudrateScannerTab } from './scanner/BaudrateScannerTab';
import { RegisterScannerTab } from './scanner/RegisterScannerTab';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: TabSession | null;
  onApplySlaveId?: (slaveId: number) => void;
  onApplyConnection?: (port: string, baud: number, parity: string) => void;
  onApplyRange?: (fc: number, startAddr: number, qty: number) => void;
}

type TabType = 'slave' | 'baudrate' | 'registers';

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  activeSession,
  onApplySlaveId,
  onApplyConnection,
  onApplyRange,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('slave');
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);

  // Load serial ports on modal open
  useEffect(() => {
    if (isOpen) {
      listSerialPorts().then((ports) => {
        setAvailablePorts(ports);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-6xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 rounded-lg border border-indigo-500/30 text-cyan-400">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                Scanner và khám phá thiết bị
              </h2>
              <p className="text-xs text-slate-400">
                Tự động tìm kiếm Slave ID, dò thông số Baudrate/Parity và giải mã thanh ghi đa cột
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

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/60 px-6 gap-2 pt-2">
          <button
            onClick={() => setActiveTab('slave')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'slave'
                ? 'bg-slate-800/90 text-cyan-400 border-cyan-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Radio className="w-4 h-4" />
            1. Quét Địa Chỉ Slave (Slave ID Scanner)
          </button>
          <button
            onClick={() => setActiveTab('baudrate')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'baudrate'
                ? 'bg-slate-800/90 text-amber-400 border-amber-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Zap className="w-4 h-4" />
            2. Dò Tốc Độ Baudrate / Parity
          </button>
          <button
            onClick={() => setActiveTab('registers')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
              activeTab === 'registers'
                ? 'bg-slate-800/90 text-emerald-400 border-emerald-500 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Layers className="w-4 h-4" />
            3. Quét Thanh Ghi & Giải Mã Đa Cột (Multi-Column)
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'slave' && (
            <SlaveIdScannerTab
              activeSession={activeSession}
              onApplySlaveId={onApplySlaveId}
              onClose={onClose}
              isOpen={isOpen}
            />
          )}

          {activeTab === 'baudrate' && (
            <BaudrateScannerTab
              availablePorts={availablePorts}
              onApplyConnection={onApplyConnection}
              onClose={onClose}
            />
          )}

          {activeTab === 'registers' && (
            <RegisterScannerTab
              activeSession={activeSession}
              onApplyRange={onApplyRange}
              onClose={onClose}
            />
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-500" />
            <span>
              Session Hiện Tại:{' '}
              <strong className="text-white">
                {activeSession ? activeSession.title : 'Chưa chọn'}
              </strong>
            </span>
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
