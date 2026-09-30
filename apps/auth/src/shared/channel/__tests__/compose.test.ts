import { describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import { combineTransports, fallbackTransport } from '../transports/compose';
import type { ChannelTransport, ChannelTransportFactory } from '../transports/types';

type Messages = { ping: { n: number } };

/** 把訊息同步轉給其他訂閱者的匯流排（不含發送者自己註冊的那一份也沒關係，createChannel 會略過）。 */
function createBus() {
  const listeners = new Set<(message: unknown) => void>();
  const post = vi.fn((envelope: unknown) => {
    for (const listener of listeners) listener(structuredClone(envelope));
  });
  const factory: ChannelTransportFactory = () => ({
    post,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {},
  });
  return { factory, post };
}

describe('fallbackTransport', () => {
  it('用第一個目前環境支援的傳輸層', () => {
    const second = createBus();
    const third = createBus();
    const channel = createChannel<Messages>('x', {
      transport: fallbackTransport(() => undefined, second.factory, third.factory),
    });

    channel.post('ping', { n: 1 });

    expect(second.post).toHaveBeenCalledTimes(1);
    expect(third.post).not.toHaveBeenCalled();
    channel.close();
  });

  it('全部都不支援時回 undefined', () => {
    expect(fallbackTransport(() => undefined)('ge:x')).toBeUndefined();
  });
});

describe('combineTransports', () => {
  it('每條路都送；同一則訊息從兩條路送達只處理一次', () => {
    const local = createBus();
    const remote = createBus();
    const transport = combineTransports(local.factory, remote.factory);
    const a = createChannel<Messages>('x', { transport });
    const b = createChannel<Messages>('x', { transport });
    const onPing = vi.fn();
    b.on('ping', onPing);

    a.post('ping', { n: 1 });

    expect(local.post).toHaveBeenCalledTimes(1);
    expect(remote.post).toHaveBeenCalledTimes(1);
    expect(onPing).toHaveBeenCalledTimes(1);
    a.close();
    b.close();
  });

  it('一條路送出失敗，其他條照送', () => {
    const healthy = createBus();
    const broken: ChannelTransport = {
      post: () => {
        throw new Error('disconnected');
      },
      subscribe: () => () => {},
      close() {},
    };
    const channel = createChannel<Messages>('x', {
      transport: combineTransports(() => broken, healthy.factory),
    });

    channel.post('ping', { n: 1 });

    expect(healthy.post).toHaveBeenCalledTimes(1);
    channel.close();
  });

  it('close 會關閉每一條路', () => {
    const closes = [vi.fn(), vi.fn()];
    const factories = closes.map((close): ChannelTransportFactory => () => ({
      post() {},
      subscribe: () => () => {},
      close,
    }));
    createChannel<Messages>('x', { transport: combineTransports(...factories) }).close();
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });
});
