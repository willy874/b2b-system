import { describe, expect, it } from 'vitest';

import { createBlobStore } from '../blobStore';

describe('createBlobStore（沒有 IndexedDB 時退回記憶體）', () => {
  it('put / get / delete', async () => {
    const store = createBlobStore('test', { indexedDB: undefined });
    const blob = new Blob(['hello']);
    await store.put('a', blob);
    await expect(store.get('a')).resolves.toBe(blob);
    await store.delete('a');
    await expect(store.get('a')).resolves.toBeUndefined();
  });

  it('clear 清掉全部', async () => {
    const store = createBlobStore('test', { indexedDB: undefined });
    await store.put('a', new Blob(['1']));
    await store.put('b', new Blob(['2']));
    await store.clear();
    await expect(store.get('a')).resolves.toBeUndefined();
    await expect(store.get('b')).resolves.toBeUndefined();
  });

  it('prune 刪掉存進來太久的項目', async () => {
    let time = 0;
    const store = createBlobStore('test', { indexedDB: undefined, now: () => time });
    await store.put('old', new Blob(['1']));
    time = 10_000;
    await store.put('new', new Blob(['2']));
    await store.prune(5_000);
    await expect(store.get('old')).resolves.toBeUndefined();
    await expect(store.get('new')).resolves.toBeDefined();
  });
});

/** 假的 IDBRequest：在下一個 microtask 完成（呼叫端先拿到 request 才掛 listener）。 */
function fakeRequest<T>(compute: () => T): IDBRequest<T> {
  const request = new EventTarget() as EventTarget & { result?: T; error: null };
  request.error = null;
  queueMicrotask(() => {
    request.result = compute();
    request.dispatchEvent(new Event('success'));
  });
  return request as unknown as IDBRequest<T>;
}

/**
 * 最小的 IndexedDB（只有 blobStore 用到的部分）：每個資料庫一個 object store，請求在下一個 microtask 完成。
 * 同一個 factory 建立的多個 BlobStore 共用資料，相當於同源的多個分頁。
 */
function createFakeIndexedDB() {
  const databases = new Map<string, Map<IDBValidKey, unknown>>();

  const factory = {
    open(name: string) {
      const isNew = !databases.has(name);
      const data = databases.get(name) ?? new Map<IDBValidKey, unknown>();
      databases.set(name, data);
      const storeNames = new Set<string>(isNew ? [] : ['blobs']);
      const store = {
        put: (value: unknown, key: IDBValidKey) => fakeRequest(() => data.set(key, value) && key),
        get: (key: IDBValidKey) => fakeRequest(() => data.get(key)),
        delete: (key: IDBValidKey) => fakeRequest(() => void data.delete(key)),
        getAllKeys: () => fakeRequest(() => [...data.keys()]),
        clear: () => fakeRequest(() => data.clear()),
      };
      const db = {
        objectStoreNames: { contains: (storeName: string) => storeNames.has(storeName) },
        createObjectStore: (storeName: string) => storeNames.add(storeName),
        transaction: () => ({ objectStore: () => store }),
      };
      const request = new EventTarget() as EventTarget & { result?: unknown; error: null };
      request.error = null;
      queueMicrotask(() => {
        request.result = db;
        if (isNew) request.dispatchEvent(new Event('upgradeneeded'));
        request.dispatchEvent(new Event('success'));
      });
      return request;
    },
  };
  return { indexedDB: factory as unknown as IDBFactory, databases };
}

describe('createBlobStore（IndexedDB）', () => {
  it('同源的其他分頁從 IndexedDB 讀得到', async () => {
    const { indexedDB } = createFakeIndexedDB();
    const tabA = createBlobStore('upload', { indexedDB });
    const tabB = createBlobStore('upload', { indexedDB });
    const blob = new Blob(['hello']);

    await tabA.put('a', blob);

    await expect(tabB.get('a')).resolves.toBe(blob);
  });

  it('★ clear 清掉本分頁的記憶體與 IndexedDB：其他分頁也讀不到了', async () => {
    const { indexedDB, databases } = createFakeIndexedDB();
    const tabA = createBlobStore('upload', { indexedDB });
    const tabB = createBlobStore('upload', { indexedDB });
    await tabA.put('a', new Blob(['1']));
    await tabA.put('b', new Blob(['2']));

    await tabA.clear();

    await expect(tabA.get('a')).resolves.toBeUndefined();
    await expect(tabB.get('b')).resolves.toBeUndefined();
    expect(databases.get('b2b-system:blob:upload')?.size).toBe(0);
  });
});
