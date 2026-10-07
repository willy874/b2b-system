import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLimiter, LimiterBusyError } from '../limiter';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('createLimiter（程序內的並行上限）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('同時最多 concurrency 個；名額依序（FIFO）交給等待者', async () => {
    const limit = createLimiter({ concurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const order: number[] = [];
    const runs = gates.map((gate, index) =>
      limit(async () => {
        order.push(index);
        await gate.promise;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([0, 1]);
    gates[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([0, 1, 2]);
    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(runs);
  });

  it('等待的名額已滿 → 立刻 LimiterBusyError（queue-full）', async () => {
    const limit = createLimiter({ concurrency: 1, maxQueue: 1 });
    const gate = deferred();
    const first = limit(() => gate.promise);
    const second = limit(async () => undefined);
    await expect(limit(async () => undefined)).rejects.toMatchObject({ reason: 'queue-full' });
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('等太久 → LimiterBusyError（timeout），之後的名額照常運作', async () => {
    const limit = createLimiter({ concurrency: 1, queueTimeoutMs: 100 });
    const gate = deferred();
    const first = limit(() => gate.promise);
    const waiting = limit(async () => 'late');
    const assertion = expect(waiting).rejects.toBeInstanceOf(LimiterBusyError);
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    gate.resolve();
    await first;
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });

  it('工作失敗也會歸還名額', async () => {
    const limit = createLimiter({ concurrency: 1 });
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(async () => 'next')).resolves.toBe('next');
  });
});
