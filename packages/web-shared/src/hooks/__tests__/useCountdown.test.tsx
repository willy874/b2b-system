import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCountdown } from '../useCountdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  it('開始後每秒遞減，數到 0 就停', () => {
    const { result } = renderHook(() => useCountdown());
    expect(result.current.remaining).toBe(0);

    act(() => result.current.start(3));
    expect(result.current.remaining).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.remaining).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.remaining).toBe(0);
  });

  it('再次開始會重新計算', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(2));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.start(10));
    expect(result.current.remaining).toBe(10);
  });
});
