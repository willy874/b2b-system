import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import { createFakeBatchQueue } from '@/test/fakeBatchQueue';

import { jobProgressAmount, jobProgressRatio } from '../activeQueue';
import { isGoneError, serializeBatchError, toBatchErrorInstance } from '../errors';
import { registerBatchOperation, resetBatchOperations } from '../operations';
import type { BatchJob, BatchRunContext } from '../types';

/** 可以從外面決定何時完成的 promise：用來驗證「一次只處理一筆」。 */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const items = (...ids: string[]) => ids.map((id) => ({ id, label: `Label ${id}` }));

let queue: ReturnType<typeof createFakeBatchQueue>;

beforeEach(() => {
  resetBatchOperations();
  queue = createFakeBatchQueue();
});

afterEach(() => {
  queue.dispose();
});

describe('批次佇列（docs/adr/0012-batch-queue-worker.md）', () => {
  it('堵塞式：一次只交派一筆，前一筆完成才送下一筆', async () => {
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const run = vi.fn((id: string) => {
      const next = deferred();
      pending.set(id, next);
      return next.promise;
    });
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run });
    const tab = queue.openTab('tab-a');
    await tab.start();

    tab.enqueue({ operation: 'op', scope: 'list', items: items('1', '2', '3') });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.lastCall?.[0]).toBe('1');

    pending.get('1')?.resolve();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.lastCall?.[0]).toBe('2');
  });

  it('多個工作依送出順序處理：後送的排隊到前一個結束', async () => {
    const calls: string[] = [];
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: async (id) => {
        calls.push(id);
      },
    });
    const tab = queue.openTab('tab-a');
    await tab.start();

    tab.enqueue({ operation: 'op', scope: 'list', items: items('a1', 'a2') });
    tab.enqueue({ operation: 'op', scope: 'list', items: items('b1') });

    await waitFor(() => expect(calls).toEqual(['a1', 'a2', 'b1']));
  });

  it('成功與失敗逐筆回報；進度經 Channel 讓其他分頁也看得到', async () => {
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: async (id) => {
        if (id === '2') throw new AppError('USER_NOT_LOCKED', 409);
      },
    });
    const owner = queue.openTab('tab-a');
    const other = queue.openTab('tab-b');
    await Promise.all([owner.start(), other.start()]);

    owner.enqueue({ operation: 'op', scope: 'list', items: items('1', '2') });

    await waitFor(() => expect(other.getJobs()[0]?.status).toBe('done'));
    const [job] = other.getJobs();
    expect(job?.succeeded).toEqual(['1']);
    expect(job?.failures).toEqual([
      {
        id: '2',
        label: 'Label 2',
        error: expect.objectContaining({ kind: 'app', code: 'USER_NOT_LOCKED' }),
      },
    ]);
  });

  it('結束時只通知發起的分頁，由它彈出結果', async () => {
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run: async () => {} });
    const owner = queue.openTab('tab-a');
    const other = queue.openTab('tab-b');
    await Promise.all([owner.start(), other.start()]);
    const ownerFinished = vi.fn();
    const otherFinished = vi.fn();
    owner.events.on('finished', ownerFinished);
    other.events.on('finished', otherFinished);

    owner.enqueue({ operation: 'op', scope: 'list', items: items('1') });

    await waitFor(() => expect(ownerFinished).toHaveBeenCalledTimes(1));
    expect(ownerFinished.mock.calls[0]?.[0]).toMatchObject({ status: 'done', succeeded: ['1'] });
    expect(otherFinished).not.toHaveBeenCalled();
  });

  it('發起的分頁在執行中離開 → 同一筆改由其他分頁執行，結束通知給它', async () => {
    const first = deferred();
    const runInOwner = vi.fn((_id: string) => first.promise);
    const runInOther = vi.fn(async (_id: string) => {});
    const owner = queue.openTab('tab-a');
    const other = queue.openTab('tab-b');
    await Promise.all([owner.start(), other.start()]);
    // 兩個分頁共用同一個註冊表：以目前的分頁切換實作
    let current = runInOwner;
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run: (id) => current(id) });
    const finished = vi.fn();
    other.events.on('finished', finished);

    owner.enqueue({ operation: 'op', scope: 'list', items: items('1', '2') });
    await waitFor(() => expect(runInOwner).toHaveBeenCalledWith('1'));

    current = runInOther;
    owner.stop();

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(runInOther.mock.calls.map(([id]) => id)).toEqual(['1', '2']);
    expect(finished.mock.calls[0]?.[0]).toMatchObject({ succeeded: ['1', '2'] });
  });

  it('取消：正在處理的那一筆做完就停，剩下的不再送出', async () => {
    const first = deferred();
    const run = vi.fn(() => first.promise);
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run });
    const tab = queue.openTab('tab-a');
    await tab.start();
    const finished = vi.fn();
    tab.events.on('finished', finished);

    const jobId = tab.enqueue({ operation: 'op', scope: 'list', items: items('1', '2', '3') });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    tab.cancel(jobId);
    first.resolve();

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(finished.mock.calls[0]?.[0]).toMatchObject({ status: 'cancelled', succeeded: ['1'] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('移除與清除已結束的工作', async () => {
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run: async () => {} });
    const tab = queue.openTab('tab-a');
    await tab.start();

    const first = tab.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    tab.enqueue({ operation: 'op', scope: 'list', items: items('2') });
    await waitFor(() => expect(tab.getJobs().map((job) => job.status)).toEqual(['done', 'done']));

    tab.dismiss(first);
    await waitFor(() => expect(tab.getJobs()).toHaveLength(1));
    tab.clearFinished();
    await waitFor(() => expect(tab.getJobs()).toHaveLength(0));
  });

  it('dedicated worker：分頁離開時宣告佇列消失，其他分頁移除它的工作', async () => {
    const pending = deferred();
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: () => pending.promise,
    });
    const ownHost = queue.createHost('dedicated-a');
    const tabA = queue.openTab('tab-a', { host: ownHost, ownsHost: true });
    const tabB = queue.openTab('tab-b');
    await Promise.all([tabA.start(), tabB.start()]);

    tabA.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(tabB.getJobs()).toHaveLength(1));

    tabA.stop();
    await waitFor(() => expect(tabB.getJobs()).toHaveLength(0));
    ownHost.dispose();
  });

  it('新分頁加入時取得既有的進度', async () => {
    const pending = deferred();
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: () => pending.promise,
    });
    const owner = queue.openTab('tab-a');
    await owner.start();
    owner.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(owner.getJobs()[0]?.status).toBe('running'));

    const late = queue.openTab('tab-late');
    await late.start();
    await waitFor(() => expect(late.getJobs()[0]?.status).toBe('running'));
  });
});

describe('批次佇列：並行、進度與中止（docs/adr/0013-file-manager-upload.md）', () => {
  it('concurrency：同一個工作同時交派數筆；後面的工作仍等前一個結束', async () => {
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const run = vi.fn((id: string) => {
      const next = deferred();
      pending.set(id, next);
      return next.promise;
    });
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run });
    const tab = queue.openTab('tab-a');
    await tab.start();

    tab.enqueue({ operation: 'op', scope: 'list', items: items('1', '2', '3'), concurrency: 2 });
    tab.enqueue({ operation: 'op', scope: 'list', items: items('b1') });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls.map(([id]) => id)).toEqual(['1', '2']);

    pending.get('2')?.resolve();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.lastCall?.[0]).toBe('3');

    pending.get('1')?.resolve();
    pending.get('3')?.resolve();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(4));
    expect(run.mock.lastCall?.[0]).toBe('b1');
  });

  it('處理中的項目回報進度，經快照讓其他分頁看到；結果回來後移除', async () => {
    const gate = deferred();
    let context: BatchRunContext | undefined;
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: (_id, ctx) => {
        context = ctx;
        return gate.promise;
      },
    });
    const owner = queue.openTab('tab-a');
    const other = queue.openTab('tab-b');
    await Promise.all([owner.start(), other.start()]);

    owner.enqueue({
      operation: 'op',
      scope: 'list',
      items: [{ id: '1', label: 'a', weight: 100 }],
    });
    await waitFor(() => expect(context).toBeDefined());
    context?.reportProgress({ loaded: 40, total: 100 });
    await waitFor(() =>
      expect(other.getJobs()[0]?.progress).toEqual({ '1': { loaded: 40, total: 100 } }),
    );

    gate.resolve();
    await waitFor(() => expect(other.getJobs()[0]?.status).toBe('done'));
    expect(other.getJobs()[0]?.progress).toEqual({});
  });

  it('取消時中止處理中的項目；被中止的那一筆不算失敗', async () => {
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: (_id, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    const tab = queue.openTab('tab-a');
    await tab.start();
    const finished = vi.fn();
    tab.events.on('finished', finished);

    const jobId = tab.enqueue({
      operation: 'op',
      scope: 'list',
      items: items('1', '2', '3'),
      concurrency: 2,
    });
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('running'));
    tab.cancel(jobId);

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(finished.mock.calls[0]?.[0]).toMatchObject({
      status: 'cancelled',
      succeeded: [],
      failures: [],
    });
  });
});

describe('jobProgressRatio', () => {
  const job = (overrides: Partial<BatchJob>): BatchJob => ({
    id: 'j',
    operation: 'op',
    scope: 's',
    ownerId: 'o',
    items: [],
    status: 'running',
    succeeded: [],
    failures: [],
    concurrency: 1,
    progress: {},
    createdAt: 0,
    ...overrides,
  });

  it('沒有份量：依筆數，處理中的依回報的比例計入', () => {
    expect(
      jobProgressRatio(
        job({
          items: items('1', '2', '3', '4'),
          succeeded: ['1'],
          progress: { '2': { loaded: 1, total: 2 } },
        }),
      ),
    ).toBeCloseTo(1.5 / 4);
  });

  it('有份量（位元組）：大檔的進度佔比較重', () => {
    const amount = jobProgressAmount(
      job({
        items: [
          { id: 'small', label: 's', weight: 10 },
          { id: 'big', label: 'b', weight: 990 },
        ],
        succeeded: ['small'],
        progress: { big: { loaded: 495, total: 990 } },
      }),
    );
    expect(amount).toEqual({ done: 505, total: 1000, weighted: true });
  });
});

describe('批次錯誤的序列化', () => {
  it('AppError 跨 worker 後還原成同樣的碼與細節', () => {
    const restored = toBatchErrorInstance(
      structuredClone(
        serializeBatchError(new AppError('ROLE_IN_USE', 409, { userCount: 2 }, 'req-1')),
      ),
    );
    expect(restored).toBeInstanceOf(AppError);
    expect(restored).toMatchObject({
      code: 'ROLE_IN_USE',
      status: 409,
      details: { userCount: 2 },
      requestId: 'req-1',
    });
  });

  it('*_NOT_FOUND 視為已不存在', () => {
    expect(isGoneError(serializeBatchError(new AppError('USER_NOT_FOUND', 404)))).toBe(true);
    expect(isGoneError(serializeBatchError(new AppError('USER_NOT_LOCKED', 409)))).toBe(false);
  });
});
