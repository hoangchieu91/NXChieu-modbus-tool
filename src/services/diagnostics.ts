import {
  listSerialPorts,
  sessionConnect,
  sessionDisconnect,
  sessionReadOnce,
  sessionWriteRegister,
  scanSlaveIDs,
  autoDetectBaudrate,
  scanRegisters,
  sessionStartPolling,
  sessionStopPolling,
  getDiagnosticSnifferSnapshot,
  closeSession,
  slaveSetRegister,
  slaveSetCoil,
  slaveGetSlice,
  slaveStartSim,
  slaveStopSim,
} from './backend';
import { DiagnosticCheck } from '../components/StudioDiagnostics';
import { PollDefinition } from '../types/modbus';

/**
 * Runs end-to-end studio diagnostics to verify:
 * 1. Wails desktop bridge connection.
 * 2. Serial port enumerator.
 * 3. Master simulator connect, read/write roundtrip.
 * 4. Scanner detection.
 * 5. Polling & analyzer pipeline isolation.
 * 6. Slave simulator memory store & simulation tick.
 */
export async function runStudioDiagnostics(): Promise<DiagnosticCheck[]> {
  const results: DiagnosticCheck[] = [];
  const check = async (name: string, action: () => Promise<string>) => {
    const started = performance.now();
    try {
      const detail = await action();
      results.push({ name, status: 'pass', detail, durationMs: Math.round(performance.now() - started) });
      return true;
    } catch (error) {
      results.push({ name, status: 'fail', detail: String(error), durationMs: Math.round(performance.now() - started) });
      return false;
    }
  };

  const bridgeReady = await check('Wails desktop bridge', async () => {
    if (!(window as any).go?.main?.App) throw new Error('Không thấy Wails bridge. Hãy chạy file EXE thay vì mở frontend bằng trình duyệt.');
    return 'Frontend đã kết nối được với Go backend.';
  });
  if (!bridgeReady) return results;

  await check('Nhận diện cổng truyền thông', async () => {
    const ports = await listSerialPorts();
    return `Backend phản hồi ${ports.length} cổng COM.`;
  });

  const masterID = `__studio_diagnostic_master_${Date.now()}`;
  let masterConnected = false;
  try {
    masterConnected = await check('Master simulator: kết nối', async () => {
      await sessionConnect(masterID, {
        type: 'serial',
        port: 'simulator',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        timeout_ms: 1000,
      });
      return 'Session simulator đã kết nối.';
    });
    if (masterConnected) {
      await check('Master simulator: đọc và ghi', async () => {
        const definition: PollDefinition = {
          slave_id: 1,
          function_code: 3,
          start_address: 20,
          quantity: 2,
          scan_rate_ms: 50,
        };
        const before = await sessionReadOnce(masterID, definition);
        if (before.error || before.values.length !== 2) throw new Error(before.error || 'Read Once không trả đủ dữ liệu.');
        await sessionWriteRegister(masterID, { slave_id: 1, address: 20, value: 4321 });
        const after = await sessionReadOnce(masterID, definition);
        if (after.error || after.values[0] !== 4321) throw new Error(after.error || `Giá trị đọc lại là ${after.values[0]}, mong đợi 4321.`);
        return 'Read Once và FC06 round-trip thành công.';
      });
      await check('Scanner: Unit, baudrate và register', async () => {
        const [devices, baud, registers] = await Promise.all([
          scanSlaveIDs(masterID, 1, 3, 50),
          autoDetectBaudrate('simulator', 1, [9600], ['none']),
          scanRegisters(masterID, 3, 0, 4),
        ]);
        if (devices[0]?.status !== 'online' || !baud[0]?.success || !registers[0]?.valid) {
          throw new Error('Scanner không nhận diện đúng simulator.');
        }
        return 'Unit 1, 9600-none và vùng Holding Register đều được nhận diện.';
      });
      await check('Polling và Analyzer pipeline', async () => {
        const definition: PollDefinition = {
          slave_id: 1,
          function_code: 3,
          start_address: 0,
          quantity: 4,
          scan_rate_ms: 50,
        };
        await sessionStartPolling(masterID, definition);
        await new Promise((resolve) => window.setTimeout(resolve, 130));
        await sessionStopPolling(masterID);
        // Self-test traffic goes to a separate analyzer so it never pollutes the real baseline,
        // health score, reports or saved captures.
        const snapshot = await getDiagnosticSnifferSnapshot(50);
        const diagnosticFrames = snapshot.frames.filter((frame) => frame.source_id === masterID);
        if (!diagnosticFrames.length) throw new Error('Polling chạy nhưng Analyzer chưa nhận được frame của phiên tự kiểm tra.');
        return `Analyzer nhận ${diagnosticFrames.length} frame từ phiên tự kiểm tra.`;
      });
    }
  } finally {
    if (masterConnected) await sessionDisconnect(masterID).catch(() => undefined);
    await closeSession(masterID).catch(() => undefined);
  }

  const slaveID = `__studio_diagnostic_slave_${Date.now()}`;
  try {
    await check('Slave memory: register và coil', async () => {
      await slaveSetRegister(slaveID, 'holding', 7, 2468);
      await slaveSetCoil(slaveID, 'coils', 3, true);
      const [registers, coils] = await Promise.all([
        slaveGetSlice(slaveID, 'holding', 7, 1),
        slaveGetSlice(slaveID, 'coils', 3, 1),
      ]);
      if (registers.values?.[0] !== 2468 || coils.bool_values?.[0] !== true) {
        throw new Error('Bộ nhớ Slave không giữ đúng dữ liệu đã ghi.');
      }
      return 'Holding register và coil round-trip thành công.';
    });
    await check('Slave simulation', async () => {
      await slaveSetRegister(slaveID, 'holding', 50, 100);
      await slaveStartSim(slaveID, {
        session_id: slaveID,
        table: 'holding',
        address: 50,
        mode: 'increment',
        min: 0,
        max: 1000,
        step: 2,
        interval_ms: 100,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 130));
      await slaveStopSim(slaveID);
      const values = await slaveGetSlice(slaveID, 'holding', 50, 1);
      if (values.values?.[0] === 100) throw new Error('Simulation chạy nhưng giá trị không thay đổi.');
      return `Thanh ghi mô phỏng đã thay đổi thành ${values.values?.[0]}.`;
    });
  } finally {
    await closeSession(slaveID).catch(() => undefined);
  }
  return results;
}
