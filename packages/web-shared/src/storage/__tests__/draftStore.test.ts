import { describe, expect, it, vi } from 'vitest';

import { createDraftStore } from '../draftStore';
import { createFakeIndexedDB } from './fakeIndexedDB';

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

describe('draftStore（IndexedDB ＋ AES-GCM）', () => {
  const DB = 'b2b-system:drafts';
  const draftsIn = (databases: Map<string, Map<string, Map<IDBValidKey, unknown>>>, name = DB) =>
    databases.get(name)?.get('drafts') ?? new Map();

  it('同源的另一個分頁讀得到（金鑰也存在同一個資料庫）', async () => {
    const { indexedDB } = createFakeIndexedDB();
    const tabA = createDraftStore({ indexedDB, now: () => 1000 });
    const tabB = createDraftStore({ indexedDB, now: () => 1000 });

    await tabA.save('t:alice', 'k', { name: 'A' });

    expect(await tabB.load('t:alice', 'k')).toEqual({ data: { name: 'A' }, savedAt: 1000 });
  });

  it('磁碟上存的是密文，不是明文', async () => {
    const { indexedDB, databases } = createFakeIndexedDB();
    const drafts = createDraftStore({ indexedDB });

    await drafts.save('t:alice', 'k', { secret: 'top-secret-value' });

    const [stored] = [...draftsIn(databases).values()] as Array<{ cipher: ArrayBuffer }>;
    expect(stored).toBeDefined();
    expect(new TextDecoder().decode(stored!.cipher)).not.toContain('top-secret-value');
  });

  it('內容損壞解不開時回 undefined，並刪掉那一筆', async () => {
    const { indexedDB, databases } = createFakeIndexedDB();
    const drafts = createDraftStore({ indexedDB });
    await drafts.save('t:alice', 'k', 1);
    for (const value of draftsIn(databases).values()) {
      (value as { cipher: ArrayBuffer }).cipher = new Uint8Array([1, 2, 3]).buffer;
    }

    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
    expect(draftsIn(databases).size).toBe(0);
  });

  it('過期的草稿讀取時順便刪掉', async () => {
    let time = 0;
    const { indexedDB, databases } = createFakeIndexedDB();
    const drafts = createDraftStore({ indexedDB, now: () => time, ttlMs: 100 });
    await drafts.save('t:alice', 'k', 1);
    time = 100;

    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
    expect(draftsIn(databases).size).toBe(0);
  });

  it('remove 只刪那一筆', async () => {
    const { indexedDB } = createFakeIndexedDB();
    const drafts = createDraftStore({ indexedDB });
    await drafts.save('t:alice', 'a', 1);
    await drafts.save('t:alice', 'b', 2);

    await drafts.remove('t:alice', 'a');

    expect(await drafts.load('t:alice', 'a')).toBeUndefined();
    expect((await drafts.load('t:alice', 'b'))?.data).toBe(2);
  });

  it('不同 dbName 的草稿互不影響：removeOwner 只作用在自己的資料庫', async () => {
    const { indexedDB } = createFakeIndexedDB();
    const forms = createDraftStore({ indexedDB });
    const imports = createDraftStore({ indexedDB, dbName: 'b2b-system:import-drafts' });
    await forms.save('t:alice', 'k', 'form');
    await imports.save('t:alice', 'k', 'import');

    await forms.removeOwner('t:alice');

    expect(await forms.load('t:alice', 'k')).toBeUndefined();
    expect((await imports.load('t:alice', 'k'))?.data).toBe('import');
  });

  it('IndexedDB 打不開時退回記憶體：本分頁仍能存取', async () => {
    const { indexedDB } = createFakeIndexedDB({ failOpen: true });
    const drafts = createDraftStore({ indexedDB });

    expect(await drafts.save('t:alice', 'k', 1)).toBe(true);
    expect((await drafts.load('t:alice', 'k'))?.data).toBe(1);
  });

  it('產生金鑰失敗時不存', async () => {
    const subtle = {
      generateKey: vi.fn().mockRejectedValue(new Error('NotSupportedError')),
    } as unknown as SubtleCrypto;
    const drafts = createDraftStore({ indexedDB: undefined, subtle });

    expect(await drafts.save('t:alice', 'k', 1)).toBe(false);
    expect(await drafts.load('t:alice', 'k')).toBeUndefined();
  });
});
