import { describe, expect, it, vi } from 'vitest';

import { ShutdownState } from '../shutdown-state';

describe('ShutdownState（docs/architecture/01-system.md §7 D13）', () => {
  it('開始排空前 draining 是 false，之後是 true', () => {
    const state = new ShutdownState();
    expect(state.draining).toBe(false);
    state.startDraining(0);
    expect(state.draining).toBe(true);
  });

  it('開始排空時通知登記的對象，帶排空的長度', () => {
    const state = new ShutdownState();
    const listener = vi.fn();
    state.onDrain(listener);

    state.startDraining(10_000);

    expect(listener).toHaveBeenCalledWith(10_000);
  });

  it('重複呼叫只通知一次', () => {
    const state = new ShutdownState();
    const listener = vi.fn();
    state.onDrain(listener);

    state.startDraining(10_000);
    state.startDraining(10_000);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
