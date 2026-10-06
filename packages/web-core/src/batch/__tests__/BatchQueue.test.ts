import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { createFakeBatchQueue } from '../../testing/fakeBatchQueue';
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

describe('批次佇列（docs/architecture/frontend/07-ui-system.md §13）', () => {
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

  it('★ reset（session 結束）：所有分頁的工作都清空，含已結束的；處理中那一筆晚到的結果不會把工作加回來', async () => {
    const pending = deferred();
    registerBatchOperation({
      id: 'done-op',
      labelKey: 'x',
      successKey: 'y',
      run: async () => {
        throw new AppError('USER_NOT_LOCKED', 409);
      },
    });
    registerBatchOperation({
      id: 'slow-op',
      labelKey: 'x',
      successKey: 'y',
      run: () => pending.promise,
    });
    const owner = queue.openTab('tab-a');
    const other = queue.openTab('tab-b');
    await Promise.all([owner.start(), other.start()]);

    owner.enqueue({ operation: 'done-op', scope: 'list', items: items('1') });
    owner.enqueue({ operation: 'slow-op', scope: 'list', items: items('2') });
    await waitFor(() =>
      expect(other.getJobs().map((job) => job.status)).toEqual(['done', 'running']),
    );
    const finished = vi.fn();
    owner.events.on('finished', finished);

    owner.reset();
    await waitFor(() => expect(other.getJobs()).toEqual([]));
    expect(owner.getJobs()).toEqual([]);
    expect(queue.host.getJobs()).toEqual([]);

    // 被中止的那一筆晚到：佇列已不認得它，不會把工作加回來，也不彈出結果。
    // 等 pending 之後，執行端的結果已經送出；之後送的工作排在它後面，處理完就代表晚到的結果也處理過了
    pending.resolve();
    await pending.promise;
    const next = owner.enqueue({ operation: 'done-op', scope: 'list', items: items('3') });
    await waitFor(() => expect(other.getJobs().map((job) => job.id)).toEqual([next]));
    expect(other.getJobs()[0]?.status).toBe('done');
    expect(finished.mock.calls.map(([job]) => (job as BatchJob).id)).toEqual([next]);
  });

  it('reset 中止處理中的項目（操作有接 signal 時立即停止）', async () => {
    let signal: AbortSignal | undefined;
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: (_id, context) =>
        new Promise((_resolve, reject) => {
          signal = context.signal;
          context.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    const tab = queue.openTab('tab-a');
    await tab.start();
    tab.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(signal).toBeDefined());

    tab.reset();

    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => expect(tab.getJobs()).toEqual([]));
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

describe('批次佇列：並行、進度與中止（docs/architecture/frontend/12-file-manager.md §14）', () => {
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

describe('批次佇列：只顯示目前身分的工作（docs/architecture/frontend/07-ui-system.md §13.2 D12）', () => {
  it('工作記下送出時的身分；其他身分的分頁看不到，換回同一個身分才看得到', async () => {
    const pending = deferred();
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: () => pending.promise,
    });
    let otherIdentity: string | undefined = 'tenant:bob';
    const alice = queue.openTab('tab-a', { principal: () => 'tenant:alice' });
    const other = queue.openTab('tab-b', { principal: () => otherIdentity });
    await Promise.all([alice.start(), other.start()]);

    alice.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(alice.getJobs()).toHaveLength(1));
    expect(alice.getJobs()[0]?.principal).toBe('tenant:alice');
    expect(queue.host.getJobs()).toHaveLength(1);
    expect(other.getJobs()).toEqual([]);

    otherIdentity = 'tenant:alice';
    other.principalChanged();
    expect(other.getJobs()).toHaveLength(1);

    // 登出（沒有身分）後什麼都看不到
    otherIdentity = undefined;
    other.principalChanged();
    expect(other.getJobs()).toEqual([]);
  });

  it('不是目前身分的工作結束時不彈出結果', async () => {
    let identity: string | undefined = 'tenant:alice';
    const tab = queue.openTab('tab-a', { principal: () => identity });
    await tab.start();
    const finished = vi.fn();
    tab.events.on('finished', finished);
    const gate = deferred();
    registerBatchOperation({ id: 'slow', labelKey: 'x', successKey: 'y', run: () => gate.promise });

    tab.enqueue({ operation: 'slow', scope: 'list', items: items('1') });
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('running'));
    identity = 'tenant:bob';
    tab.principalChanged();
    gate.resolve();

    await waitFor(() => expect(queue.host.getJobs()[0]?.status).toBe('done'));
    expect(finished).not.toHaveBeenCalled();
  });
});

/** 分頁各自的操作清單（同一個程序裡的分頁共用註冊表，要模擬「只有某些分頁安裝了 feature」就用它）。 */
function operationSource(initial: string[]) {
  let ids = initial;
  const listeners = new Set<() => void>();
  return {
    ids: () => ids,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: string[]) {
      ids = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('批次佇列：分頁宣告能執行的操作（docs/architecture/frontend/02-plugin-system.md §9.2 D10）', () => {
  it('發起的分頁沒有安裝這個操作時，交給宣告支援的分頁執行', async () => {
    const run = vi.fn(() => Promise.resolve());
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run });
    const owner = queue.openTab('tab-a', { operations: operationSource([]) });
    const other = queue.openTab('tab-b', { operations: operationSource(['op']) });
    await owner.start();
    await other.start();

    owner.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    await waitFor(() => expect(owner.getJobs()[0]?.status).toBe('done'));
  });

  it('沒有分頁支援時工作保持排隊（不判定失敗），有分頁宣告支援後才執行', async () => {
    const run = vi.fn(() => Promise.resolve());
    registerBatchOperation({ id: 'op', labelKey: 'x', successKey: 'y', run });
    const operations = operationSource([]);
    const tab = queue.openTab('tab-a', { operations });
    await tab.start();

    tab.enqueue({ operation: 'op', scope: 'list', items: items('1') });
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('queued'));
    expect(run).not.toHaveBeenCalled();

    operations.set(['op']);
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('done'));
    expect(tab.getJobs()[0]?.failures).toEqual([]);
  });

  it('分頁卸載了某個操作（feature 被停用）→ 佇列取消使用它的工作', async () => {
    registerBatchOperation({
      id: 'op',
      labelKey: 'x',
      successKey: 'y',
      run: () => new Promise<void>(() => undefined),
    });
    const operations = operationSource(['other']);
    const tab = queue.openTab('tab-a', { operations });
    await tab.start();
    operations.set(['other', 'op']);
    // 先塞一個永遠等不到分頁的工作
    tab.enqueue({ operation: 'missing', scope: 'list', items: items('1') });
    tab.enqueue({ operation: 'op', scope: 'list', items: items('2') });
    await waitFor(() => expect(tab.getJobs()).toHaveLength(2));

    operations.set(['other']);
    await waitFor(() =>
      expect(tab.getJobs().map((job) => [job.operation, job.status])).toEqual([
        ['missing', 'queued'],
        ['op', 'cancelled'],
      ]),
    );
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
