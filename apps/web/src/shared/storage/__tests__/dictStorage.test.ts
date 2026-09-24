import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '@/shared/channel';
import { createFakeChannelHub } from '@/test/fakeChannelHub';

import { createDictStorage } from '../dictStorage';

afterEach(() => {
  globalThis.localStorage.clear();
  vi.restoreAllMocks();
});

describe('dictStorage', () => {
  it('以命名空間前綴隔離，避免與同網域的其他東西衝突', () => {
    createDictStorage('layout').set('sidebarCollapsed', true);
    expect(globalThis.localStorage.getItem('game-editor:layout:sidebarCollapsed')).toBe('true');
  });

  it('讀不到時回 fallback', () => {
    expect(createDictStorage('layout').get('missing', 'default')).toBe('default');
  });

  it('localStorage 拋例外時回 fallback，不讓 app 掛掉（私密瀏覽 / 空間已滿）', () => {
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(createDictStorage('layout').get('anything', 'fallback')).toBe('fallback');
  });

  it('寫入失敗不會拋出', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => createDictStorage('layout').set('key', 'value')).not.toThrow();
  });

  it('壞掉的 JSON 回 fallback', () => {
    globalThis.localStorage.setItem('game-editor:layout:broken', '{not json');
    expect(createDictStorage('layout').get('broken', 42)).toBe(42);
  });

  it('remove 會刪掉該鍵', () => {
    const storage = createDictStorage('layout');
    storage.set('key', 'value');
    storage.remove('key');
    expect(storage.get('key', 'gone')).toBe('gone');
  });
});

/** 每次呼叫代表一個分頁裡的同一份 dictStorage；本機分頁共用同一份 localStorage。 */
function openTabs(count: number) {
  const hub = createFakeChannelHub();
  return Array.from({ length: count }, () =>
    createDictStorage('preference', {
      channel: createChannel('store:test', { transport: hub.transport() }),
    }),
  );
}

describe('dictStorage（帶頻道）', () => {
  it('一個分頁寫入，其他分頁的訂閱者收到新值', async () => {
    const [a, b] = openTabs(2);
    const listener = vi.fn();
    b?.subscribe('locale', listener);

    a?.set('locale', 'en_US');

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('en_US'));
    expect(b?.get('locale', 'zh_TW')).toBe('en_US');
  });

  it('自己的寫入不通知自己；只通知訂閱的 key', async () => {
    const [a, b] = openTabs(2);
    const own = vi.fn();
    const other = vi.fn();
    a?.subscribe('locale', own);
    b?.subscribe('timezone', other);

    a?.set('locale', 'en_US');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(own).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });

  it('移除時訂閱者收到 undefined', async () => {
    const [a, b] = openTabs(2);
    const listener = vi.fn();
    b?.subscribe('locale', listener);

    a?.remove('locale');

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(undefined));
  });

  it('dispose 之後不再收發', async () => {
    const [a, b] = openTabs(2);
    const listener = vi.fn();
    b?.subscribe('locale', listener);
    b?.dispose();

    a?.set('locale', 'en_US');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).not.toHaveBeenCalled();
  });
});
