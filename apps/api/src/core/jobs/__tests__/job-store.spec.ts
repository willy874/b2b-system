import { describe, expect, it, vi } from 'vitest';

import type { PlatformDatabase } from '../../database';
import { JobStore } from '../job-store';

/**
 * 查詢的 SQL 與 pg-boss 表結構由整合測試（test/jobs.spec.ts）驗證；這裡只測 JobStore 自己的分支：
 * 空的佇列清單不查詢、計數補零、時間欄位轉成 Date、放回佇列的結果分類。
 */
function setup(...results: Array<unknown[] | Error>) {
  const execute = vi.fn(async () => {
    const next = results.shift() ?? [];
    if (next instanceof Error) throw next;
    return next;
  });
  const store = new JobStore({ execute } as unknown as PlatformDatabase);
  return { store, execute };
}

const ROW = {
  id: 'job-1',
  name: 'test.work',
  tenantId: 't1',
  state: 'completed',
  data: { id: 'x' },
  output: { done: true },
  retryCount: 1,
  retryLimit: 5,
  createdOn: '2026-10-01T00:00:00.000Z',
  startAfter: '2026-10-01T00:00:01.000Z',
  startedOn: '2026-10-01T00:00:02.000Z',
  completedOn: null,
};

describe('JobStore.list（docs/architecture/backend/10-jobs.md §6）', () => {
  it('沒有已註冊的工作 → 回空列表，不查詢', async () => {
    const { store, execute } = setup();
    await expect(store.list({ tenantId: 't1', names: [], offset: 0, limit: 50 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('postgres.js 回傳的時間字串轉成 Date，null 維持 null', async () => {
    const { store } = setup([ROW], [{ total: 1 }]);
    const { items, total } = await store.list({
      tenantId: 't1',
      names: ['test.work'],
      offset: 0,
      limit: 50,
    });
    expect(total).toBe(1);
    expect(items[0]).toEqual({
      ...ROW,
      createdOn: new Date('2026-10-01T00:00:00.000Z'),
      startAfter: new Date('2026-10-01T00:00:01.000Z'),
      startedOn: new Date('2026-10-01T00:00:02.000Z'),
      completedOn: null,
    });
  });

  it('計數查詢沒有回列 → total 為 0', async () => {
    const { store } = setup([], []);
    await expect(
      store.list({ tenantId: null, names: ['test.work'], offset: 0, limit: 50 }),
    ).resolves.toEqual({ items: [], total: 0 });
  });
});

describe('JobStore.counts', () => {
  const ZERO = {
    readyCount: 0,
    deferredCount: 0,
    activeCount: 0,
    failedCount: 0,
    completedCount: 0,
  };

  it('沒有已註冊的工作 → 空的 Map，不查詢', async () => {
    const { store, execute } = setup();
    const counts = await store.counts('t1', []);
    expect(counts.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('每個名稱都有一筆；表裡沒有工作的佇列補 0', async () => {
    const counted = { ...ZERO, failedCount: 2, completedCount: 7 };
    const { store } = setup([{ name: 'test.a', ...counted }]);
    const counts = await store.counts(undefined, ['test.a', 'test.b']);
    expect(Object.fromEntries(counts)).toEqual({ 'test.a': counted, 'test.b': ZERO });
  });
});

describe('JobStore.find', () => {
  it('沒有已註冊的工作 → undefined，不查詢', async () => {
    const { store, execute } = setup();
    await expect(store.find('t1', [], 'job-1')).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('查無 → undefined', async () => {
    const { store } = setup([]);
    await expect(store.find('t1', ['test.work'], 'job-1')).resolves.toBeUndefined();
  });

  it('找到 → 時間欄位轉成 Date（含已完成的 completedOn）', async () => {
    const { store } = setup([{ ...ROW, completedOn: '2026-10-01T00:00:03.000Z' }]);
    const job = await store.find('t1', ['test.work'], 'job-1');
    expect(job?.completedOn).toEqual(new Date('2026-10-01T00:00:03.000Z'));
    expect(job?.createdOn).toBeInstanceOf(Date);
  });
});

describe('JobStore.activeAhead（docs/architecture/05-tenancy.md §13.3 D9）', () => {
  it('回傳排在前面的 active 筆數', async () => {
    const { store } = setup([{ ahead: 3 }]);
    await expect(store.activeAhead('t1', 'job-1')).resolves.toBe(3);
  });

  it('查詢沒有回列 → 0（交給 pg-boss 自己處理）', async () => {
    const { store } = setup([]);
    await expect(store.activeAhead('t1', 'job-1')).resolves.toBe(0);
  });
});

describe('JobStore.requeue（docs/architecture/05-tenancy.md §13.3 D9）', () => {
  it('更新到一列 → requeued', async () => {
    const { store } = setup([{ id: 'job-1' }]);
    await expect(store.requeue('test.work', 'job-1', 7)).resolves.toBe('requeued');
  });

  it('沒有更新到（已不是 active：逾時被收回、被取消）→ gone', async () => {
    const { store } = setup([]);
    await expect(store.requeue('test.work', 'job-1', 7)).resolves.toBe('gone');
  });

  it('exclusive 佇列已有一筆排隊（唯一索引 23505）→ conflict', async () => {
    const { store } = setup(Object.assign(new Error('duplicate key'), { code: '23505' }));
    await expect(store.requeue('test.work', 'job-1', 7)).resolves.toBe('conflict');
  });

  it('其他資料庫錯誤往外拋', async () => {
    const { store } = setup(Object.assign(new Error('connection lost'), { code: '08006' }));
    await expect(store.requeue('test.work', 'job-1', 7)).rejects.toThrow('connection lost');
  });
});
