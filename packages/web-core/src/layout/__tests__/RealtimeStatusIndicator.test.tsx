import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { setActiveRealtimeClient } from '../../realtime';
import type { RealtimeClient } from '../../realtime';
import { initTestI18n } from '../../testing';
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
  beforeAll(() => initTestI18n());
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

  it('三種狀態的圖示不同，不只靠顏色區分（WCAG 1.4.1）', () => {
    const { client, setConnected } = fakeClient();
    const icons = new Set<string | null>();
    const { unmount } = render(<RealtimeStatusIndicator />);
    icons.add(screen.getByTestId('realtime-status').getAttribute('data-icon'));
    unmount();

    setActiveRealtimeClient(client);
    render(<RealtimeStatusIndicator />);
    const status = screen.getByTestId('realtime-status');
    icons.add(status.getAttribute('data-icon'));
    act(() => setConnected(true));
    icons.add(status.getAttribute('data-icon'));

    expect(icons).toEqual(new Set(['wifi-off', 'warning', 'wifi']));
  });

  it('中斷時頂列直接顯示文字（不必滑過也看得到）；連上後拿掉', () => {
    const { client, setConnected } = fakeClient();
    setActiveRealtimeClient(client);
    render(<RealtimeStatusIndicator />);
    expect(screen.getByTestId('realtime-status-text')).toHaveTextContent('即時更新已中斷');
    // 報讀器念的是完整的說明，不重複念這段
    expect(screen.getByTestId('realtime-status-text')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('realtime-status')).toHaveTextContent('即時連線：未連線');

    act(() => setConnected(true));
    expect(screen.queryByTestId('realtime-status-text')).not.toBeInTheDocument();
  });
});
