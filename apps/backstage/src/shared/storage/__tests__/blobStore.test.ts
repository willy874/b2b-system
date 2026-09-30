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
