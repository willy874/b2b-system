import { describe, expect, it } from 'vitest';

import { createBlobStore } from '../blobStore';
import { createFakeIndexedDB } from './fakeIndexedDB';

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
    expect(databases.get('b2b-system:blob:upload')?.get('blobs')?.size).toBe(0);
  });

  it('prune 也刪掉 IndexedDB 裡過期的項目，其他分頁讀不到', async () => {
    let time = 0;
    const { indexedDB } = createFakeIndexedDB();
    const tabA = createBlobStore('upload', { indexedDB, now: () => time });
    await tabA.put('old', new Blob(['1']));
    time = 10_000;
    await tabA.put('new', new Blob(['2']));

    await tabA.prune(5_000);

    const tabB = createBlobStore('upload', { indexedDB });
    await expect(tabB.get('old')).resolves.toBeUndefined();
    await expect(tabB.get('new')).resolves.toBeDefined();
  });

  it('delete 也從 IndexedDB 刪掉', async () => {
    const { indexedDB } = createFakeIndexedDB();
    const tabA = createBlobStore('upload', { indexedDB });
    const tabB = createBlobStore('upload', { indexedDB });
    await tabA.put('a', new Blob(['1']));

    await tabA.delete('a');

    await expect(tabB.get('a')).resolves.toBeUndefined();
  });

  it('IndexedDB 打不開時退回記憶體：本分頁照常，其他分頁讀不到', async () => {
    const { indexedDB } = createFakeIndexedDB({ failOpen: true });
    const tabA = createBlobStore('upload', { indexedDB });
    const tabB = createBlobStore('upload', { indexedDB });
    const blob = new Blob(['1']);

    await tabA.put('a', blob);

    await expect(tabA.get('a')).resolves.toBe(blob);
    await expect(tabB.get('a')).resolves.toBeUndefined();
  });

  it('IndexedDB 的交易失敗時吞掉錯誤，本分頁的記憶體仍可用', async () => {
    const { indexedDB } = createFakeIndexedDB({ failTransaction: true });
    const store = createBlobStore('upload', { indexedDB });
    const blob = new Blob(['1']);

    await expect(store.put('a', blob)).resolves.toBeUndefined();
    await expect(store.get('a')).resolves.toBe(blob);
    await expect(store.get('missing')).resolves.toBeUndefined();
    await expect(store.prune(0)).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
