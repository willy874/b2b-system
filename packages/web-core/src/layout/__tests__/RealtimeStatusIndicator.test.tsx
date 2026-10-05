import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setActiveRealtimeClient } from '../../realtime';
import type { RealtimeClient } from '../../realtime';
import { RealtimeStatusIndicator } from '../RealtimeStatusIndicator';

/** 只需要 `isConnected` 與 `subscribe` 的假連線。 */
function fakeClient() {
  const listeners = new Set<() => void>();
  const client = {
    isConnected: false,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setConnected = (connected: boolean) => {
    client.isConnected = connected;
    for (const listener of listeners) listener();
  };
  return { client: client as unknown as RealtimeClient, setConnected };
}

describe('RealtimeStatusIndicator（頂列的即時連線狀態）', () => {
  afterEach(() => setActiveRealtimeClient(undefined));

  it('沒有註冊推播時顯示未啟用', () => {
    render(<RealtimeStatusIndicator />);
    expect(screen.getByTestId('realtime-status')).toHaveAttribute('data-value', 'disabled');
  });

  it('跟著連線狀態切換', () => {
    const { client, setConnected } = fakeClient();
    setActiveRealtimeClient(client);
    render(<RealtimeStatusIndicator />);
    const status = screen.getByTestId('realtime-status');
    expect(status).toHaveAttribute('data-value', 'disconnected');

    act(() => setConnected(true));
    expect(status).toHaveAttribute('data-value', 'connected');

    act(() => setConnected(false));
    expect(status).toHaveAttribute('data-value', 'disconnected');
  });
});
