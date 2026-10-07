import { describe, expect, it } from 'vitest';

import { createDraftStore } from '../draftStore';

/** 測試環境沒有 IndexedDB：只用記憶體，但仍以 WebCrypto 加解密。 */
function store(options: { now?: () => number; maxEntries?: number; maxBytes?: number } = {}) {
  return createDraftStore({ indexedDB: undefined, ...options });
}

describe('draftStore（docs/architecture/frontend/09-state-and-storage.md §4.4）', () => {
  it('存下的草稿能讀回；不同擁有者互相看不到', async () => {
    const drafts = store({ now: () => 1000 });
    expect(await drafts.save('t:alice', 'user.detail:1', { name: 'A' })).toBe(true);
    expect(await drafts.load('t:alice', 'user.detail:1')).toEqual({
      data: { name: 'A' },
      savedAt: 1000,
    });
    expect(await drafts.load('t:bob', 'user.detail:1')).toBeUndefined();
  });

  it('24 小時後過期', async () => {
    let time = 0;
    const drafts = store({ now: () => time });
    await drafts.save('t:alice', 'k', { a: 1 });
    time = 24 * 60 * 60 * 1000;
    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
  });

  it('超過筆數上限刪掉最舊的；太大的不存', async () => {
    let time = 0;
    const drafts = store({ now: () => (time += 1), maxEntries: 2, maxBytes: 64 });
    await drafts.save('t:alice', 'a', 1);
    await drafts.save('t:alice', 'b', 2);
    await drafts.save('t:alice', 'c', 3);
    expect(await drafts.load('t:alice', 'a')).toBeUndefined();
    expect((await drafts.load('t:alice', 'c'))?.data).toBe(3);
    expect(await drafts.save('t:alice', 'big', 'x'.repeat(100))).toBe(false);
  });

  it('removeOwner 只刪那個人的；keepOnlyOwner 只留那個人的', async () => {
    const drafts = store();
    await drafts.save('t:alice', 'k', 1);
    await drafts.save('t:bob', 'k', 2);
    await drafts.save('t:carol', 'k', 3);
    await drafts.removeOwner('t:alice');
    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
    await drafts.keepOnlyOwner('t:bob');
    expect(await drafts.load('t:carol', 'k')).toBeUndefined();
    expect((await drafts.load('t:bob', 'k'))?.data).toBe(2);
  });

  it('沒有 WebCrypto 時不存（不在任何地方留明文）', async () => {
    const drafts = createDraftStore({ indexedDB: undefined, subtle: undefined });
    expect(await drafts.save('t:alice', 'k', 1)).toBe(false);
    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
  });
});
