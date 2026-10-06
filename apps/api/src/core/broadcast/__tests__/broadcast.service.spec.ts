import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlatformSql } from '../../database';
import { BroadcastService, MAX_PAYLOAD_BYTES } from '../broadcast.service';
import type { BroadcastChannelSubscriber } from '../broadcast.service';
import { BroadcastHub, flushBroadcast } from './broadcast-hub';

interface Ping {
  n: number;
}

function parsePing(value: unknown): Ping | null {
  return typeof value === 'object' && value !== null && typeof (value as Ping).n === 'number'
    ? { n: (value as Ping).n }
    : null;
}

function pingSubscriber() {
  return {
    parse: parsePing,
    onMessage: vi.fn<(message: Ping) => void>(),
    onReconnect: vi.fn<() => void>(),
  } satisfies BroadcastChannelSubscriber<Ping>;
}

/** 兩個已開始監聽的程序，各自在 `ping` 頻道上有一個帶型別的訂閱者。 */
async function twoProcesses() {
  const hub = new BroadcastHub();
  const [a, b] = [hub.instance(), hub.instance()];
  const [onA, onB] = [pingSubscriber(), pingSubscriber()];
  const publishA = a.channel('ping', onA);
  const publishB = b.channel('ping', onB);
  await a.onApplicationBootstrap();
  await b.onApplicationBootstrap();
  return { hub, a, b, onA, onB, publishA, publishB };
}

describe('BroadcastService.channel（docs/architecture/01-system.md §4.4、backend/07-testing.md §8）', () => {
  it('其他程序收到解析後的訊息', async () => {
    const { onB, publishA } = await twoProcesses();
    await publishA({ n: 1 });
    await flushBroadcast();
    expect(onB.onMessage).toHaveBeenCalledWith({ n: 1 });
  });

  it('自己送的訊息不交給自己', async () => {
    const { onA, publishA } = await twoProcesses();
    await publishA({ n: 1 });
    await flushBroadcast();
    expect(onA.onMessage).not.toHaveBeenCalled();
  });

  it('送出的 payload 是帶著送出程序 id 的信封', async () => {
    const { hub, a, publishA } = await twoProcesses();
    await publishA({ n: 7 });
    expect(hub.sent).toEqual([['ping', JSON.stringify({ o: a.instanceId, m: { n: 7 } })]]);
  });

  it('每個程序的 instanceId 都不同', () => {
    const hub = new BroadcastHub();
    expect(hub.instance().instanceId).not.toBe(hub.instance().instanceId);
  });

  it.each([
    ['不是 JSON', 'not json'],
    ['沒有 o', JSON.stringify({ m: { n: 1 } })],
    ['o 不是字串', JSON.stringify({ o: 1, m: { n: 1 } })],
    ['沒有 m', JSON.stringify({ o: 'other' })],
    ['JSON 是 null', 'null'],
  ])('信封格式不對的訊息略過：%s', async (_name, payload) => {
    const { a, onB } = await twoProcesses();
    await a.publish('ping', payload);
    await flushBroadcast();
    expect(onB.onMessage).not.toHaveBeenCalled();
  });

  it('信封正確但 parse 回 null（不同版本的格式）→ 略過', async () => {
    const { a, onB } = await twoProcesses();
    await a.publish('ping', JSON.stringify({ o: 'other', m: { n: 'x' } }));
    await flushBroadcast();
    expect(onB.onMessage).not.toHaveBeenCalled();
  });

  it('只交給同一個頻道的訂閱者', async () => {
    const { a, onB } = await twoProcesses();
    await a.publish('pong', JSON.stringify({ o: 'other', m: { n: 1 } }));
    await flushBroadcast();
    expect(onB.onMessage).not.toHaveBeenCalled();
  });

  it('監聽連線重連時呼叫 onReconnect；第一次接上不呼叫', async () => {
    const { hub, onA, onB } = await twoProcesses();
    expect(onB.onReconnect).not.toHaveBeenCalled();

    hub.reconnect();
    await flushBroadcast();
    expect(onA.onReconnect).toHaveBeenCalledTimes(1);
    expect(onB.onReconnect).toHaveBeenCalledTimes(1);
  });

  it('沒有 onReconnect 的訂閱者在重連時不出錯，訊息照常收到', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [hub.instance(), hub.instance()];
    const onMessage = vi.fn();
    const publish = a.channel<Ping>('ping', { parse: parsePing, onMessage: vi.fn() });
    b.channel<Ping>('ping', { parse: parsePing, onMessage });
    await a.onApplicationBootstrap();
    await b.onApplicationBootstrap();

    hub.reconnect();
    await publish({ n: 2 });
    await flushBroadcast();
    expect(onMessage).toHaveBeenCalledWith({ n: 2 });
  });
});

describe('BroadcastService.subscribe／publish', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribe 的訂閱者收到原始 payload，含自己送出的', async () => {
    const hub = new BroadcastHub();
    const service = hub.instance();
    const onMessage = vi.fn();
    service.subscribe('raw', { onMessage });
    await service.onApplicationBootstrap();

    await service.publish('raw', 'hello');
    await flushBroadcast();
    expect(onMessage).toHaveBeenCalledWith('hello');
  });

  it('同一個頻道的一個訂閱者拋錯：記錄後繼續交給下一個', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const hub = new BroadcastHub();
    const service = hub.instance();
    const second = vi.fn();
    service.subscribe('raw', {
      onMessage: () => {
        throw new Error('boom');
      },
    });
    service.subscribe('raw', { onMessage: second });
    await service.onApplicationBootstrap();

    await service.publish('raw', 'x');
    await flushBroadcast();
    expect(second).toHaveBeenCalledWith('x');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ channel: 'raw' }), '處理廣播失敗');
  });

  it('payload 達到 NOTIFY 的上限 → 拋錯（程式錯誤：只該送 key）', async () => {
    const service = new BroadcastHub().instance();
    await expect(service.publish('raw', 'a'.repeat(MAX_PAYLOAD_BYTES))).rejects.toThrow(/raw/);
    await expect(
      service.publish('raw', 'a'.repeat(MAX_PAYLOAD_BYTES - 1)),
    ).resolves.toBeUndefined();
  });

  it('上限以位元組計算，不是字元數', async () => {
    const service = new BroadcastHub().instance();
    // 一個中文字 3 位元組
    const text = '中'.repeat(Math.ceil(MAX_PAYLOAD_BYTES / 3));
    await expect(service.publish('raw', text)).rejects.toThrow();
  });

  it('NOTIFY 失敗只記錄、不拋出（廣播是加速，不是正確性的來源）', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const sql = { notify: vi.fn(async () => Promise.reject(new Error('db down'))) };
    const service = new BroadcastService(sql as unknown as PlatformSql);

    await expect(service.publish('raw', 'x')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ channel: 'raw' }), '送出廣播失敗');
  });

  it('每個有訂閱者的頻道開一個監聽，程序關閉時全部取消監聽', async () => {
    const unlisten = vi.fn(async () => {});
    const sql = {
      listen: vi.fn(async (_channel: string, _onMessage: unknown, onListen: () => void) => {
        onListen();
        return { unlisten };
      }),
    };
    const service = new BroadcastService(sql as unknown as PlatformSql);
    service.subscribe('a', { onMessage: vi.fn() });
    service.subscribe('a', { onMessage: vi.fn() });
    service.subscribe('b', { onMessage: vi.fn() });

    await service.onApplicationBootstrap();
    expect(sql.listen.mock.calls.map(([channel]) => channel)).toEqual(['a', 'b']);

    await service.onApplicationShutdown();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('取消監聽之後不再收到訊息', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [hub.instance(), hub.instance()];
    const onMessage = vi.fn();
    b.subscribe('raw', { onMessage });
    await b.onApplicationBootstrap();
    await b.onApplicationShutdown();

    await a.publish('raw', 'x');
    await flushBroadcast();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('取消監聽失敗不影響關閉流程', async () => {
    const sql = {
      listen: vi.fn(async () => ({ unlisten: vi.fn(async () => Promise.reject(new Error('x'))) })),
    };
    const service = new BroadcastService(sql as unknown as PlatformSql);
    service.subscribe('a', { onMessage: vi.fn() });
    await service.onApplicationBootstrap();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
