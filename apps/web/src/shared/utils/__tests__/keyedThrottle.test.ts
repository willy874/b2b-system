import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeJitterDelay, createKeyedThrottle } from '../keyedThrottle';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeJitterDelay', () => {
  it.each([
    [0, 150],
    [0.5, 450],
    [0.999, 749.4],
  ])('random=%s → 落在 [min, max) 內', (random, expected) => {
    expect(computeJitterDelay(() => random, { min: 150, max: 750 })).toBeCloseTo(expected);
  });

  it('max <= min 時固定為 min', () => {
    expect(computeJitterDelay(() => 0.9, { min: 100, max: 100 })).toBe(100);
  });
});

describe('createKeyedThrottle（以 key 去重、隨機延遲削峰）', () => {
  const range = { min: 100, max: 100 };

  it('延遲後執行', () => {
    const throttle = createKeyedThrottle();
    const task = vi.fn();

    throttle.schedule('k', task, range);
    vi.advanceTimersByTime(99);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('同一個 key 還沒執行時再排：只執行最新的一個', () => {
    const throttle = createKeyedThrottle();
    const first = vi.fn();
    const latest = vi.fn();

    throttle.schedule('k', first, range);
    throttle.schedule('k', latest, range);
    vi.advanceTimersByTime(100);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('不同 key 互不取消', () => {
    const throttle = createKeyedThrottle();
    const a = vi.fn();
    const b = vi.fn();

    throttle.schedule('a', a, range);
    throttle.schedule('b', b, range);
    vi.advanceTimersByTime(100);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('cancel 與 stop 清掉還沒執行的工作', () => {
    const throttle = createKeyedThrottle();
    const a = vi.fn();
    const b = vi.fn();

    throttle.schedule('a', a, range);
    throttle.schedule('b', b, range);
    throttle.cancel('a');
    throttle.stop();
    vi.advanceTimersByTime(100);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
