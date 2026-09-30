import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { relayChannelMessages } from '../relays/serviceWorkerRelay';
import type { ServiceWorkerScopeLike } from '../relays/serviceWorkerRelay';
import { serviceWorkerTransport } from '../transports/serviceWorker';

type Messages = { ping: { n: number } };
type RelayListener = Parameters<ServiceWorkerScopeLike['addEventListener']>[1];

const opened: Channel<Messages>[] = [];

/** 一個 Service Worker ＋ 它控制的多個分頁；分頁 → controller → relay → 其他分頁。 */
function startServiceWorker() {
  let onMessage: RelayListener | undefined;
  const pending: Promise<unknown>[] = [];
  const clients: { id: string; postMessage: (message: unknown) => void }[] = [];
  relayChannelMessages({
    clients: { matchAll: () => Promise.resolve(clients) },
    addEventListener: (_type, listener) => {
      onMessage = listener;
    },
  });

  const openTab = (id: string, { controlled = true } = {}) => {
    const container = new EventTarget() as EventTarget & {
      controller: { postMessage: (message: unknown) => void } | null;
      startMessages: () => void;
    };
    container.startMessages = vi.fn();
    container.controller = controlled
      ? {
          postMessage: (data) =>
            onMessage?.({ data, source: { id }, waitUntil: (promise) => pending.push(promise) }),
        }
      : null;
    clients.push({
      id,
      postMessage: (data) => container.dispatchEvent(new MessageEvent('message', { data })),
    });
    const channel = createChannel<Messages>('x', {
      transport: serviceWorkerTransport(container as unknown as ServiceWorkerContainer),
    });
    opened.push(channel);
    return { channel, container };
  };

  const flush = () => Promise.all(pending.splice(0));
  return { openTab, flush };
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe('serviceWorkerTransport ＋ relayChannelMessages（經 Service Worker 中繼）', () => {
  it('SW 把一個分頁的訊息轉給其他分頁，不轉回來源', async () => {
    const sw = startServiceWorker();
    const a = sw.openTab('a');
    const b = sw.openTab('b');
    const onSelf = vi.fn();
    const onPeer = vi.fn();
    a.channel.on('ping', onSelf);
    b.channel.on('ping', onPeer);

    a.channel.post('ping', { n: 1 });
    await sw.flush();

    expect(onPeer).toHaveBeenCalledWith({ n: 1 });
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('呼叫 startMessages()，addEventListener 註冊的 listener 才收得到', () => {
    const { container } = startServiceWorker().openTab('a');
    expect(container.startMessages).toHaveBeenCalled();
  });

  it('頁面還沒被 SW 控制時送出不拋例外（訊息丟棄）', () => {
    const { channel } = startServiceWorker().openTab('a', { controlled: false });
    expect(() => channel.post('ping', { n: 1 })).not.toThrow();
  });

  it('不是頻道外框的訊息 relay 不處理（不影響 SW 的其他協定）', () => {
    const waitUntil = vi.fn();
    let onMessage: RelayListener | undefined;
    relayChannelMessages({
      clients: { matchAll: () => Promise.resolve([]) },
      addEventListener: (_type, listener) => {
        onMessage = listener;
      },
    });

    onMessage?.({ data: { type: 'KEEPALIVE_REQUEST' }, source: { id: 'a' }, waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('沒有 serviceWorker 的環境回 undefined', () => {
    expect(serviceWorkerTransport(undefined)('ge:x')).toBeUndefined();
  });
});
