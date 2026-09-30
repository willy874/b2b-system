import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerEvent } from '@/shared/websocket-sdk';

import { setActiveRealtimeClient } from '../activeClient';
import type { RealtimeClient } from '../RealtimeClient';
import { useRealtimeEvent } from '../useRealtimeEvent';

type AnyListener = (...args: unknown[]) => void;

/** 只需要 `onServerEvent`：驗證與重連由 RealtimeClient 自己的測試負責。 */
function fakeClient() {
  const listeners = new Map<string, Set<AnyListener>>();
  const client = {
    onServerEvent: vi.fn((event: string, listener: AnyListener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    }),
  };
  const push = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  setActiveRealtimeClient(client as unknown as RealtimeClient);
  return { client, push, count: (event: string) => listeners.get(event)?.size ?? 0 };
}

afterEach(() => {
  setActiveRealtimeClient(undefined);
});

describe('useRealtimeEvent（docs/architecture/frontend/11-realtime.md §8）', () => {
  it('收到事件時呼叫最新一次 render 的 handler，不因 handler 換新而重新訂閱', () => {
    const { client, push } = fakeClient();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }) => useRealtimeEvent(ServerEvent.SESSION_REVOKED, handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    push(ServerEvent.SESSION_REVOKED, { reason: 'AUTH_TOKEN_STALE' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ reason: 'AUTH_TOKEN_STALE' });
    expect(client.onServerEvent).toHaveBeenCalledTimes(1);
  });

  it('unmount 時取消訂閱', () => {
    const { count } = fakeClient();
    const { unmount } = renderHook(() => useRealtimeEvent(ServerEvent.SESSION_EXPIRED, vi.fn()));
    expect(count(ServerEvent.SESSION_EXPIRED)).toBe(1);

    unmount();

    expect(count(ServerEvent.SESSION_EXPIRED)).toBe(0);
  });

  it('推播停用（沒有連線）時什麼都不做', () => {
    expect(() =>
      renderHook(() => useRealtimeEvent(ServerEvent.SESSION_EXPIRED, vi.fn())),
    ).not.toThrow();
  });
});
