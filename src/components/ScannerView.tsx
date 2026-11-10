import React, { useState, useEffect } from 'react';
import {
  Search,
  Cpu,
  Layers,
  Radio,
  Zap,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { TabSession, SerialPortDetail } from '../types/modbus';
import { listSerialPorts } from '../services/backend';
import { SlaveIdScannerTab } from './scanner/SlaveIdScannerTab';
import { BaudrateScannerTab } from './scanner/BaudrateScannerTab';
import { RegisterScannerTab } from './scanner/RegisterScannerTab';
import { AutoDiscoveryTab } from './scanner/AutoDiscoveryTab';
import { Compass } from 'lucide-react';

interface ScannerViewProps {
  activeSession: TabSession | null;
  onApplySlaveId?: (slaveId: number) => void;
  onApplyConnection?: (port: string, baud: number, parity: string) => void;
  onApplyRange?: (fc: number, startAddr: number, qty: number) => void;
  onReturnToRegisters?: () => void;
}

type TabType = 'autodiscover' | 'slave' | 'baudrate' | 'registers';

export const ScannerView: React.FC<ScannerViewProps> = ({
  activeSession,
  onApplySlaveId,
  onApplyConnection,
  onApplyRange,
  onReturnToRegisters,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('autodiscover');
  const [availablePorts, setAvailablePorts] = useState<SerialPortDetail[]>([]);
  const [isRefreshingPorts, setIsRefreshingPorts] = useState(false);

  const fetchPorts = async () => {
    setIsRefreshingPorts(true);
    try {
      const ports = await listSerialPorts();
      setAvailablePorts(ports);
    } catch (err) {
      console.error('Lỗi khi nạp danh sách cổng serial:', err);
    } finally {
      setIsRefreshingPorts(false);
    }
  };

  useEffect(() => {
    fetchPorts();
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Header Banner */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-3">
          {onReturnToRegisters && (
            <button
              onClick={onReturnToRegisters}
              title="Quay lại bảng thanh ghi"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition border border-slate-700/60"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 rounded-lg border border-indigo-500/30 text-cyan-400">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              Modbus Scanner & Diagnostic Explorer
            </h2>
            <p className="text-xs text-slate-400">
              Dò quét tự động Slave ID, tốc độ Baudrate/Parity và khảo sát vùng thanh ghi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/50">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              Session Hiện Tại:{' '}
              <strong className="text-cyan-300">
                {activeSession ? activeSession.title : 'Chưa chọn'}
              </strong>
            </span>
          </div>

          <button
            onClick={fetchPorts}
            disabled={isRefreshingPorts}
            title="Làm mới danh sách cổng COM"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700/60 transition text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingPorts ? 'animate-spin' : ''}`} />
            <span>Làm mới cổng</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-slate-800/90 bg-slate-900/60 px-5 gap-2 pt-2 shrink-0">
        <button
          onClick={() => setActiveTab('autodiscover')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 ${
            activeTab === 'autodiscover'
              ? 'bg-slate-800/90 text-cyan-400 border-cyan-500 shadow-sm'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Compass className="w-4 h-4 text-cyan-400" />
          ⭐ Dò Tự Động Toàn Diện (Find All)
        </button>
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
          3. Quét Thanh Ghi &amp; Giải Mã Đa Cột
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'autodiscover' && (
            <AutoDiscoveryTab
              availablePorts={availablePorts}
              activePort={availablePorts[0]?.port_name || ''}
              onApplyDevice={(port, baud, parity, slaveId) => {
                if (onApplyConnection) onApplyConnection(port, baud, parity);
                if (onApplySlaveId) onApplySlaveId(slaveId);
                if (onReturnToRegisters) onReturnToRegisters();
              }}
            />
          )}

          {activeTab === 'slave' && (
            <SlaveIdScannerTab
              activeSession={activeSession}
              onApplySlaveId={onApplySlaveId}
              onClose={() => {}}
              isOpen={true}
            />
          )}

          {activeTab === 'baudrate' && (
            <BaudrateScannerTab
              availablePorts={availablePorts}
              onApplyConnection={onApplyConnection}
              onClose={() => {}}
            />
          )}

          {activeTab === 'registers' && (
            <RegisterScannerTab
              activeSession={activeSession}
              onApplyRange={onApplyRange}
              onClose={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  );
};
