import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import type { ChannelTransportFactory } from '../transports/types';

type Messages = { ping: { n: number }; bye: { reason: string } };

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
const opened: Channel<Messages>[] = [];

/**
 * 同步的記憶體匯流排：像伺服器一樣把訊息轉給「所有人」（包含發送者），
 * 用來驗證 createChannel 自己負責的語意，與傳輸層無關。
 */
function createBus() {
  const listeners = new Set<(message: unknown) => void>();
  const post = vi.fn((envelope: unknown) => {
    const copy = structuredClone(envelope);
    for (const listener of listeners) listener(copy);
  });
  const factory: ChannelTransportFactory = () => ({
    post,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {},
  });
  const inject = (message: unknown) => {
    for (const listener of listeners) listener(message);
  };
  return { factory, post, inject };
}

function open(name: string, transport?: ChannelTransportFactory): Channel<Messages> {
  const channel = createChannel<Messages>(name, { transport });
  opened.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe('createChannel（與傳輸層無關的語意）', () => {
  it('依 type 分派給對應的 listener', () => {
    const bus = createBus();
    const [a, b] = [open('x', bus.factory), open('x', bus.factory)];
    const onPing = vi.fn();
    const onBye = vi.fn();
    b.on('ping', onPing);
    b.on('bye', onBye);

    a.post('ping', { n: 1 });

    expect(onPing).toHaveBeenCalledWith({ n: 1 });
    expect(onBye).not.toHaveBeenCalled();
  });

  it('傳輸層把訊息轉回發送者時，發送者自己不會收到', () => {
    const bus = createBus();
    const a = open('x', bus.factory);
    const onSelf = vi.fn();
    a.on('ping', onSelf);

    a.post('ping', { n: 1 });

    expect(bus.post).toHaveBeenCalledTimes(1);
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('共用同一條連線時，以頻道名稱分流', () => {
    const bus = createBus();
    const a = open('one', bus.factory);
    const same = open('one', bus.factory);
    const other = open('two', bus.factory);
    const onSame = vi.fn();
    const onOther = vi.fn();
    same.on('ping', onSame);
    other.on('ping', onOther);

    a.post('ping', { n: 1 });

    expect(onSame).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
  });

  it('同一則訊息送達兩次只處理一次', () => {
    const bus = createBus();
    const b = open('x', bus.factory);
    const onPing = vi.fn();
    b.on('ping', onPing);
    const envelope = {
      tag: 'ge-channel',
      channel: 'ge:x',
      type: 'ping',
      payload: { n: 1 },
      sender: 'other',
      id: 'other:1',
    };

    bus.inject(envelope);
    bus.inject(structuredClone(envelope));

    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it('不是頻道外框、或不認得的 type 直接略過（其他協定、其他版本）', () => {
    const bus = createBus();
    const b = open('x', bus.factory);
    const onPing = vi.fn();
    b.on('ping', onPing);

    bus.inject('not-an-envelope');
    bus.inject({ type: 'ping', payload: { n: 1 } });
    bus.inject({
      tag: 'ge-channel',
      channel: 'ge:x',
      type: 'unknown',
      payload: 1,
      sender: 's',
      id: 's:1',
    });

    expect(onPing).not.toHaveBeenCalled();
  });

  it('傳輸層不支援時退化成本地運作，post 不拋出', () => {
    const channel = open('x', () => undefined);
    expect(() => channel.post('ping', { n: 1 })).not.toThrow();
  });

  it('傳輸層送出時拋例外不會傳到呼叫端', () => {
    const channel = open('x', () => ({
      post: () => {
        throw new Error('DataCloneError');
      },
      subscribe: () => () => {},
      close() {},
    }));
    expect(() => channel.post('ping', { n: 1 })).not.toThrow();
  });

  it('取消訂閱與 close 之後不再收到，close 後 post 不再送出', () => {
    const bus = createBus();
    const [a, b, c] = [open('x', bus.factory), open('x', bus.factory), open('x', bus.factory)];
    const onB = vi.fn();
    const onC = vi.fn();
    b.on('ping', onB)();
    c.on('ping', onC);

    a.post('ping', { n: 1 });
    c.close();
    a.post('ping', { n: 2 });
    a.close();
    a.post('ping', { n: 3 });

    expect(onB).not.toHaveBeenCalled();
    expect(onC).toHaveBeenCalledTimes(1);
    expect(bus.post).toHaveBeenCalledTimes(2);
  });
});

describe.runIf(hasBroadcastChannel)('createChannel（預設傳輸層 BroadcastChannel）', () => {
  it('同名頻道的其他實例收得到，自己收不到', async () => {
    const [a, b] = [open('bc'), open('bc')];
    const onSelf = vi.fn();
    const onPeer = vi.fn();
    a.on('ping', onSelf);
    b.on('ping', onPeer);

    a.post('ping', { n: 1 });

    await vi.waitFor(() => expect(onPeer).toHaveBeenCalledWith({ n: 1 }));
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('不同名稱的頻道彼此隔離', async () => {
    const a = open('bc-1');
    const same = open('bc-1');
    const other = open('bc-2');
    const onSame = vi.fn();
    const onOther = vi.fn();
    same.on('ping', onSame);
    other.on('ping', onOther);

    a.post('ping', { n: 1 });

    await vi.waitFor(() => expect(onSame).toHaveBeenCalled());
    expect(onOther).not.toHaveBeenCalled();
  });
});
