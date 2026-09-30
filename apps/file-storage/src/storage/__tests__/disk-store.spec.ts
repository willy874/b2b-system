import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiskStore } from '../disk-store';
import type { ObjectWriteOptions } from '../types';

const WRITE: ObjectWriteOptions = {
  headers: { contentType: 'text/plain' },
  metadata: {},
  expectedSize: undefined,
  contentMd5: undefined,
  maxSize: 1024,
  ifNoneMatch: undefined,
  ifMatch: undefined,
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'disk-store-spec-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(store: DiskStore, key: string, body = key): Promise<void> {
  await store.putObject('b', key, Readable.from([Buffer.from(body)]), WRITE);
}

const keysOf = (store: DiskStore) => store.listObjects('b').map((object) => object.key);

describe('DiskStore 的物件清單（PERF-18：寫入時就地維持排序）', () => {
  it('亂序寫入、覆寫、刪除之後，清單仍依 UTF-8 位元組序排列', async () => {
    const store = await DiskStore.open(root);
    await store.createBucket('b');
    // 「😀」（補充平面）在 UTF-16 排在「ｚ」之前，UTF-8 位元組序則在後面
    for (const key of ['m', 'a/2', '😀', 'a/1', 'ｚ', 'z']) {
      // oxlint-disable-next-line no-await-in-loop -- 依序寫入，驗證每次插入的位置
      await put(store, key);
    }
    await put(store, 'a/1', 'overwritten');
    await store.deleteObject('b', 'm');

    expect(keysOf(store)).toEqual(['a/1', 'a/2', 'z', 'ｚ', '😀']);
    expect(store.listObjects('b')[0]?.size).toBe('overwritten'.length);
  });

  it('重新開啟時從磁碟載入並排序', async () => {
    const store = await DiskStore.open(root);
    await store.createBucket('b');
    await put(store, 'c');
    await put(store, 'a');
    await put(store, 'b');

    const reopened = await DiskStore.open(root);
    expect(keysOf(reopened)).toEqual(['a', 'b', 'c']);
    await put(reopened, 'aa');
    expect(keysOf(reopened)).toEqual(['a', 'aa', 'b', 'c']);
  });
});
