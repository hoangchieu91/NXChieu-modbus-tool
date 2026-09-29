import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Go bindings and Wails runtime only exist inside the desktop app; mock them.
const goResult = {
  session_id: 'tab-1',
  timestamp: '12:00:00.000',
  slave_id: 2,
  function_code: 3,
  start_address: 100,
  values: [1, 2],
  bool_values: [],
  is_coil: false,
  tx_count: 5,
  err_count: 0,
  latency_ms: 8,
  raw_tx: '00 01',
  raw_rx: '00 01',
};
let pollHandler: ((data: unknown) => void) | null = null;

vi.mock('../../wailsjs/go/main/App', () => ({
  SessionReadOnce: vi.fn(async () => goResult),
}));
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, cb: (data: unknown) => void) => {
    if (name === 'poll-data') pollHandler = cb;
    return () => {};
  }),
}));

describe('PollResult mapping from Go', () => {
  beforeEach(() => {
    pollHandler = null;
  });

  // The stale-result guard and address mapping in App.tsx rely on these fields; they were once
  // silently dropped here.
  it('keeps the request fields for Read Once', async () => {
    const { sessionReadOnce } = await import('./backend');
    const res = await sessionReadOnce('tab-1', { slave_id: 2, function_code: 3, start_address: 100, quantity: 2, scan_rate_ms: 1000 });
    expect(res).toMatchObject({ slave_id: 2, function_code: 3, start_address: 100 });
  });

  it('keeps the request fields for poll events', async () => {
    const { subscribePollData } = await import('./backend');
    const received: unknown[] = [];
    subscribePollData((d) => received.push(d));
    expect(pollHandler).not.toBeNull();
    pollHandler!(goResult);
    expect(received[0]).toMatchObject({ slave_id: 2, function_code: 3, start_address: 100 });
  });
});
