import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { storageTransport } from '../transports/storage';

type Messages = { ping: { n: number } };

const opened: Channel<Messages>[] = [];

function open(): Channel<Messages> {
  const channel = createChannel<Messages>('x', { transport: storageTransport() });
  opened.push(channel);
  return channel;
}

beforeEach(() => {
  // jsdom 不會對同一個 document 觸發 storage 事件；寫入時自己補發，模擬「其他分頁看到的事件」
  // jsdom 的 localStorage 是 Proxy，spy 實例會被當成寫入一個叫 setItem 的鍵；改 spy 原型
  const { setItem, removeItem } = Storage.prototype;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    setItem.call(this, key, value);
    globalThis.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    removeItem.call(this, key);
    globalThis.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
  });
});

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
  vi.restoreAllMocks();
  globalThis.localStorage.clear();
});

describe('storageTransport（localStorage 的 storage 事件）', () => {
  it('寫入命名空間化的鍵後立刻刪除，不留下資料', () => {
    open().post('ping', { n: 1 });

    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'game-editor:channel:ge:x',
      expect.stringContaining('"ping"'),
    );
    expect(globalThis.localStorage.getItem('game-editor:channel:ge:x')).toBeNull();
  });

  it('其他分頁收得到，刪除那一次的事件不會變成訊息', () => {
    const [a, b] = [open(), open()];
    const onPing = vi.fn();
    b.on('ping', onPing);

    a.post('ping', { n: 1 });
    a.post('ping', { n: 1 });

    expect(onPing).toHaveBeenCalledTimes(2);
    expect(onPing).toHaveBeenCalledWith({ n: 1 });
  });

  it('localStorage 無法存取時回 undefined，頻道退化成本地運作', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(storageTransport()('ge:x')).toBeUndefined();
  });
});
