import React, { useState, useRef } from 'react';
import {
  FileCode2,
  Play,
  Square,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Download,
  X,
} from 'lucide-react';
import { TabSession } from '../types/modbus';

export type MacroStepAction = 'WRITE_REG' | 'WRITE_COIL' | 'READ_CHECK' | 'DELAY';

export interface MacroStep {
  id: string;
  action: MacroStepAction;
  address: number;
  value: number | boolean;
  operator?: '==' | '!=' | '>' | '>=' | '<' | '<=';
  expectedValue?: number;
  delayMs: number;
  description: string;
  status?: 'pending' | 'running' | 'pass' | 'fail';
  actualResult?: string;
  durationMs?: number;
}

interface MacroRunnerStudioProps {
  activeTab: TabSession;
  onExecuteWriteRegister: (address: number, val: number) => Promise<boolean>;
  onExecuteWriteCoil: (address: number, val: boolean) => Promise<boolean>;
  onExecuteReadValue: (address: number) => Promise<number | null>;
  onClose: () => void;
}

const SAMPLE_SCRIPTS: Record<string, { name: string; steps: MacroStep[] }> = {
  relay_burnin: {
    name: 'Kiểm tra độ bền Relay (Burn-in On/Off)',
    steps: [
      { id: '1', action: 'WRITE_COIL', address: 0, value: true, delayMs: 500, description: 'Bật Cuộn hút Relay 1' },
      { id: '2', action: 'DELAY', address: 0, value: 0, delayMs: 1000, description: 'Chờ tiếp điểm đóng ổn định' },
      { id: '3', action: 'WRITE_COIL', address: 0, value: false, delayMs: 500, description: 'Tắt Cuộn hút Relay 1' },
      { id: '4', action: 'DELAY', address: 0, value: 0, delayMs: 1000, description: 'Chờ tiếp điểm nhả hoàn toàn' },
    ],
  },
  voltage_ramp: {
    name: 'Quét bậc thang điện áp (0V -> 100V -> 220V)',
    steps: [
      { id: '1', action: 'WRITE_REG', address: 0, value: 0, delayMs: 500, description: 'Đặt điện áp 0V ban đầu' },
      { id: '2', action: 'DELAY', address: 0, value: 0, delayMs: 1000, description: 'Giữ mức 0V trong 1s' },
      { id: '3', action: 'WRITE_REG', address: 0, value: 1000, delayMs: 500, description: 'Tăng điện áp lên 100.0V' },
      { id: '4', action: 'DELAY', address: 0, value: 0, delayMs: 1500, description: 'Giữ mức 100V trong 1.5s' },
      { id: '5', action: 'WRITE_REG', address: 0, value: 2205, delayMs: 500, description: 'Tăng điện áp lên 220.5V' },
      { id: '6', action: 'DELAY', address: 0, value: 0, delayMs: 2000, description: 'Giữ mức định mức 220V trong 2s' },
      { id: '7', action: 'WRITE_REG', address: 0, value: 0, delayMs: 500, description: 'Hạ điện áp về 0V an toàn' },
    ],
  },
  threshold_assert: {
    name: 'Kiểm tra ngưỡng áp suất & Cảnh báo',
    steps: [
      { id: '1', action: 'DELAY', address: 0, value: 0, delayMs: 500, description: 'Chờ bus ổn định' },
      { id: '2', action: 'READ_CHECK', address: 2, value: 0, operator: '<=', expectedValue: 800, delayMs: 500, description: 'Kiểm tra Áp suất Reg 40003 <= 8.0 bar' },
      { id: '3', action: 'WRITE_COIL', address: 1, value: true, delayMs: 1000, description: 'Bật van xả khí khẩn cấp nếu áp suất trong chuẩn' },
    ],
  },
};

export const MacroRunnerStudio: React.FC<MacroRunnerStudioProps> = ({
  activeTab: _activeTab,
  onExecuteWriteRegister,
  onExecuteWriteCoil,
  onExecuteReadValue,
  onClose,
}) => {
  const [scriptName, setScriptName] = useState<string>('Kịch bản kiểm thử Modbus 1');
  const [steps, setSteps] = useState<MacroStep[]>(SAMPLE_SCRIPTS.relay_burnin.steps);
  const [loopCount, setLoopCount] = useState<number>(5);
  const [currentLoop, setCurrentLoop] = useState<number>(1);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(-1);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [stopOnError, setStopOnError] = useState<boolean>(true);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);

  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const logMessage = (msg: string) => {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setExecutionLogs((prev) => [...prev.slice(-200), `[${timeStr}] ${msg}`]);
  };

  const handleReset = () => {
    setIsRunning(false);
    setIsPaused(false);
    setCurrentStepIdx(-1);
    setCurrentLoop(1);
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'pending', actualResult: undefined, durationMs: undefined })));
    logMessage('Đã đặt lại kịch bản về trạng thái ban đầu.');
  };

  const executeSingleStep = async (step: MacroStep): Promise<boolean> => {
    const start = Date.now();
    try {
      if (step.action === 'WRITE_REG') {
        const ok = await onExecuteWriteRegister(step.address, Number(step.value));
        const duration = Date.now() - start;
        step.durationMs = duration;
        if (ok) {
          step.status = 'pass';
          step.actualResult = `Ghi ${step.value} thành công`;
          logMessage(`✓ [Bước ${step.id}] ${step.description}: Ghi Reg ${step.address} = ${step.value} OK (${duration}ms)`);
          return true;
        } else {
          step.status = 'fail';
          step.actualResult = 'Ghi thất bại';
          logMessage(`✗ [Bước ${step.id}] ${step.description}: Ghi Reg ${step.address} thất bại!`);
          return false;
        }
      } else if (step.action === 'WRITE_COIL') {
        const ok = await onExecuteWriteCoil(step.address, Boolean(step.value));
        const duration = Date.now() - start;
        step.durationMs = duration;
        if (ok) {
          step.status = 'pass';
          step.actualResult = `Ghi ${step.value ? 'ON' : 'OFF'} thành công`;
          logMessage(`✓ [Bước ${step.id}] ${step.description}: Ghi Coil ${step.address} = ${step.value ? 'ON' : 'OFF'} OK (${duration}ms)`);
          return true;
        } else {
          step.status = 'fail';
          step.actualResult = 'Ghi thất bại';
          logMessage(`✗ [Bước ${step.id}] ${step.description}: Ghi Coil ${step.address} thất bại!`);
          return false;
        }
      } else if (step.action === 'READ_CHECK') {
        const currentVal = await onExecuteReadValue(step.address);
        const duration = Date.now() - start;
        step.durationMs = duration;
        if (currentVal === null) {
          step.status = 'fail';
          step.actualResult = 'Không đọc được giá trị';
          logMessage(`✗ [Bước ${step.id}] ${step.description}: Đọc Reg ${step.address} không có phản hồi!`);
          return false;
        }
        const exp = step.expectedValue ?? 0;
        let pass = false;
        const op = step.operator || '==';
        if (op === '==') pass = currentVal === exp;
        else if (op === '!=') pass = currentVal !== exp;
        else if (op === '>') pass = currentVal > exp;
        else if (op === '>=') pass = currentVal >= exp;
        else if (op === '<') pass = currentVal < exp;
        else if (op === '<=') pass = currentVal <= exp;

        step.status = pass ? 'pass' : 'fail';
        step.actualResult = `Đo: ${currentVal} (${op} ${exp})`;
        if (pass) {
          logMessage(`✓ [Bước ${step.id}] ${step.description}: Đạt chuẩn (${currentVal} ${op} ${exp})`);
        } else {
          logMessage(`✗ [Bước ${step.id}] ${step.description}: Không đạt (${currentVal} không thỏa ${op} ${exp})`);
        }
        return pass;
      } else if (step.action === 'DELAY') {
        const delay = step.delayMs || 500;
        logMessage(`⏳ [Bước ${step.id}] ${step.description}: Chờ ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        step.status = 'pass';
        step.durationMs = delay;
        step.actualResult = `Chờ ${delay}ms`;
        return true;
      }
      return true;
    } catch (err) {
      step.status = 'fail';
      step.actualResult = String(err);
      logMessage(`✗ [Bước ${step.id}] Lỗi ngoại lệ: ${err}`);
      return false;
    }
  };

  const handleRunAll = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setIsPaused(false);
    logMessage(`=== BẮT ĐẦU CHẠY KỊCH BẢN: ${scriptName} (Lặp ${loopCount} lần) ===`);

    for (let l = 1; l <= loopCount; l++) {
      if (!isRunningRef.current) break;
      setCurrentLoop(l);
      if (loopCount > 1) {
        logMessage(`--- VÒNG LẶP ${l}/${loopCount} ---`);
      }

      for (let i = 0; i < steps.length; i++) {
        if (!isRunningRef.current) break;
        while (isPausedRef.current && isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!isRunningRef.current) break;

        setCurrentStepIdx(i);
        const step = { ...steps[i], status: 'running' as const };
        setSteps((prev) => prev.map((s, idx) => (idx === i ? step : s)));

        const success = await executeSingleStep(step);
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...step } : s)));

        if (!success && stopOnError) {
          logMessage(`⛔ Dừng kịch bản do Bước ${step.id} thất bại (Stop on Error = ON)`);
          setIsRunning(false);
          return;
        }

        // Delay between steps
        if (step.delayMs > 0 && step.action !== 'DELAY') {
          await new Promise((r) => setTimeout(r, step.delayMs));
        }
      }
    }

    setIsRunning(false);
    setCurrentStepIdx(-1);
    logMessage('=== KỊCH BẢN ĐÃ KẾT THÚC HOÀN TẤT ===');
  };

  const handleAddStep = () => {
    const newId = String(steps.length + 1);
    const newStep: MacroStep = {
      id: newId,
      action: 'WRITE_REG',
      address: 0,
      value: 100,
      delayMs: 500,
      description: `Ghi thanh ghi ${newId}`,
    };
    setSteps([...steps, newStep]);
  };

  const handleRemoveStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx));
  };

  const handleExportJSON = () => {
    const data = JSON.stringify({ name: scriptName, loopCount, steps }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Macro_${scriptName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-950 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <FileCode2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white text-sm">Auto-Scripting & Macro Test Runner</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/50">
                Automated Verification
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Tự động hóa chuỗi kiểm thử Modbus: Ghi giá trị, kiểm tra ngưỡng cảnh báo (Assert), tạo trễ và lặp lại thử nghiệm độ bền (Burn-in test).
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Đóng Macro Runner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. SCRIPT SELECTOR & CONTROLS */}
      <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Preset templates */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Mẫu có sẵn:</span>
            <select
              disabled={isRunning}
              onChange={(e) => {
                const preset = SAMPLE_SCRIPTS[e.target.value];
                if (preset) {
                  setScriptName(preset.name);
                  setSteps(preset.steps);
                  handleReset();
                }
              }}
              className="bg-transparent text-amber-300 font-bold text-xs outline-none cursor-pointer"
            >
              <option value="relay_burnin" className="bg-slate-900 text-white">Kiểm tra độ bền Relay (Burn-in)</option>
              <option value="voltage_ramp" className="bg-slate-900 text-white">Quét bậc thang điện áp</option>
              <option value="threshold_assert" className="bg-slate-900 text-white">Kiểm tra ngưỡng áp suất</option>
            </select>
          </div>

          {/* Loop count */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 gap-2 font-mono">
            <span className="text-[11px] text-slate-400 font-sans font-medium">Số Lần Lặp:</span>
            <input
              type="number"
              disabled={isRunning}
              min={1}
              max={1000}
              value={loopCount}
              onChange={(e) => setLoopCount(Number(e.target.value))}
              className="w-12 bg-transparent text-cyan-300 font-bold text-xs outline-none text-center"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={stopOnError}
              onChange={(e) => setStopOnError(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-amber-500"
            />
            <span>Dừng khi gặp lỗi (Stop on Error)</span>
          </label>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition"
            title="Lưu kịch bản ra file JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Lưu JSON</span>
          </button>

          <button
            disabled={isRunning}
            onClick={handleReset}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition disabled:opacity-30"
            title="Đặt lại kịch bản"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={isRunning ? () => setIsRunning(false) : handleRunAll}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs transition shadow-lg ${
              isRunning
                ? 'bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30'
                : 'bg-amber-300 text-slate-950 hover:bg-amber-200'
            }`}
          >
            {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isRunning ? 'Dừng Kịch Bản' : 'Chạy Kịch Bản (Run)'}</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE: STEPS TABLE & EXECUTION LOG */}
      <div className="flex-1 flex overflow-hidden p-5 gap-5">
        {/* Left: Step Sequence Editor */}
        <div className="flex-1 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl p-4 overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-xs uppercase tracking-wider">
                Các Bước Trong Kịch Bản ({steps.length} bước)
              </span>
              {isRunning && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-950 text-amber-300 border border-amber-600 animate-pulse">
                  Vòng {currentLoop}/{loopCount}
                </span>
              )}
            </div>

            <button
              disabled={isRunning}
              onClick={handleAddStep}
              className="flex items-center gap-1 px-3 py-1 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition text-xs font-bold disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm Bước</span>
            </button>
          </div>

          {/* Steps List */}
          <div className="flex-1 overflow-y-auto space-y-2 mt-3 pr-1">
            {steps.map((step, idx) => {
              const isCurrent = currentStepIdx === idx;
              return (
                <div
                  key={step.id}
                  className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 text-xs ${
                    isCurrent
                      ? 'bg-amber-950/40 border-amber-500 ring-1 ring-amber-500'
                      : step.status === 'pass'
                      ? 'bg-emerald-950/20 border-emerald-800/40 text-slate-300'
                      : step.status === 'fail'
                      ? 'bg-rose-950/20 border-rose-800/40 text-slate-300'
                      : 'bg-slate-950/80 border-slate-800/80 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-slate-500 font-bold w-5 text-center">#{idx + 1}</span>

                    {/* Action Pill */}
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] shrink-0 ${
                        step.action === 'WRITE_REG'
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/50'
                          : step.action === 'WRITE_COIL'
                          ? 'bg-purple-950 text-purple-300 border border-purple-700/50'
                          : step.action === 'READ_CHECK'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {step.action}
                    </span>

                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-white truncate">{step.description}</span>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                        {step.action !== 'DELAY' && (
                          <span>Addr: <strong className="text-cyan-400">{step.address}</strong></span>
                        )}
                        {step.action === 'WRITE_REG' && (
                          <span>Val: <strong className="text-amber-300">{step.value}</strong></span>
                        )}
                        {step.action === 'WRITE_COIL' && (
                          <span>Val: <strong className="text-purple-300">{step.value ? 'ON' : 'OFF'}</strong></span>
                        )}
                        {step.action === 'READ_CHECK' && (
                          <span>Assert: <strong className="text-amber-300">{step.operator} {step.expectedValue}</strong></span>
                        )}
                        <span>Trễ: {step.delayMs}ms</span>
                      </div>
                    </div>
                  </div>

                  {/* Status readout & Actions */}
                  <div className="flex items-center gap-3 shrink-0 font-mono text-[11px]">
                    {step.status === 'running' && (
                      <span className="text-amber-400 font-bold animate-pulse">RUNNING...</span>
                    )}
                    {step.status === 'pass' && (
                      <div className="flex items-center gap-1 text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>PASS {step.durationMs ? `(${step.durationMs}ms)` : ''}</span>
                      </div>
                    )}
                    {step.status === 'fail' && (
                      <div className="flex items-center gap-1 text-rose-400 font-bold">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>FAIL ({step.actualResult})</span>
                      </div>
                    )}

                    <button
                      disabled={isRunning}
                      onClick={() => handleRemoveStep(idx)}
                      className="p-1 rounded hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition disabled:opacity-20"
                      title="Xóa bước này"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Execution Console Output */}
        <div className="w-96 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl p-4 overflow-hidden shrink-0">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="font-bold text-white text-xs uppercase tracking-wider">Nhật Ký Thực Thi (Console)</span>
            <button
              onClick={() => setExecutionLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition"
            >
              Xóa log
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 font-mono text-[11px] space-y-1 mt-3 text-slate-300">
            {executionLogs.length === 0 ? (
              <p className="text-slate-600 text-center py-12 font-sans text-xs">Sẵn sàng. Bấm "Chạy Kịch Bản" để bắt đầu.</p>
            ) : (
              executionLogs.map((log, i) => (
                <div
                  key={i}
                  className={`leading-relaxed ${
                    log.includes('✓')
                      ? 'text-emerald-400'
                      : log.includes('✗') || log.includes('⛔')
                      ? 'text-rose-400'
                      : log.includes('===')
                      ? 'text-amber-300 font-bold'
                      : 'text-slate-400'
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
