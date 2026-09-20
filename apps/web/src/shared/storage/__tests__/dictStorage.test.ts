import { afterEach, describe, expect, it, vi } from 'vitest';

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
