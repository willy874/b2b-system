import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import type { Database } from '../../database';
import { AppException } from '../../errors';
import type { Tenancy, TenantDirectory, TenantRecord } from '../../tenant';
import { JobQueue } from '../job-queue';
import type { JobContext, JobEnvelope } from '../job-queue';
import type { JobStore } from '../job-store';
import { defineJob } from '../job-type';

const TYPE = defineJob<{ id: string }>('test.work');
const CONTEXT = { id: 'job-1', retryCount: 0, signal: new AbortController().signal } as JobContext;

interface QueueDeps {
  /** 以 id 找到的租戶；預設找不到（不判斷同時執行數）。 */
  tenant?: Pick<TenantRecord, 'featureParams'>;
  store?: Partial<JobStore>;
}

/** 不啟動 pg-boss（建構時不連線）。 */
function setupQueue(run: Tenancy['run'] = vi.fn(), deps: QueueDeps = {}) {
  const config = {
    get: vi.fn((key: string) =>
      key === 'PLATFORM_DATABASE_URL' ? 'postgres://u:p@127.0.0.1:1/x' : undefined,
    ),
  } as unknown as ConfigService<Env, true>;
  const tenancy = { run } as unknown as Tenancy;
  const directory = { findById: vi.fn(async () => deps.tenant) } as unknown as TenantDirectory;
  const store = (deps.store ?? {}) as JobStore;
  return { queue: new JobQueue(config, tenancy, directory, {} as Database, store) };
}

/** 只測 handler 的執行規則。 */
function setup(run: Tenancy['run'], deps: QueueDeps = {}) {
  const { queue } = setupQueue(run, deps);
  const handler = vi.fn(async () => ({ done: true }));
  const execute = (envelope: JobEnvelope) =>
    (
      queue as unknown as {
        execute: (
          registration: { type: typeof TYPE; handler: typeof handler; cron: undefined },
          envelope: JobEnvelope,
          context: JobContext,
        ) => Promise<object | void>;
      }
    ).execute({ type: TYPE, handler, cron: undefined }, envelope, CONTEXT);
  return { execute, handler };
}

const ENVELOPE: JobEnvelope = { tenantId: 't1', payload: { id: 'x' } };

describe('JobQueue：租戶不能進入時的工作（docs/adr/0020-physical-tenant-isolation.md D15）', () => {
  it('租戶已刪除 → 略過（重試也不會成功）', async () => {
    const { execute } = setup(async () => {
      throw new AppException('TENANT_NOT_FOUND');
    });
    await expect(execute(ENVELOPE)).resolves.toEqual({ skipped: 'TENANT_NOT_FOUND' });
  });

  it('租戶停用 → 略過', async () => {
    const { execute } = setup(async () => {
      throw new AppException('TENANT_UNAVAILABLE', { reason: 'inactive' });
    });
    await expect(execute(ENVELOPE)).resolves.toEqual({ skipped: 'TENANT_UNAVAILABLE' });
  });

  it('migration 落後或 DB 連不上 → 拋出，交給 pg-boss 重試（不能把工作丟掉）', async () => {
    const { execute } = setup(async () => {
      throw new AppException('TENANT_UNAVAILABLE', { reason: 'maintenance' });
    });
    await expect(execute(ENVELOPE)).rejects.toMatchObject({ code: 'TENANT_UNAVAILABLE' });
  });

  it('可以進入 → 在租戶裡執行 handler', async () => {
    const { execute, handler } = setup(async (_id, fn) => fn());
    await expect(execute(ENVELOPE)).resolves.toEqual({ done: true });
    expect(handler).toHaveBeenCalledWith({ id: 'x' }, CONTEXT);
  });
});

/** 租戶可以進入：直接執行 handler。 */
const runInside: Tenancy['run'] = async (_id, fn) => fn();

describe('JobQueue：租戶的同時執行上限（docs/adr/0033-feature-params-and-webhook-targets.md D9）', () => {
  it('排在上限以內 → 照常執行', async () => {
    const requeue = vi.fn();
    const { execute, handler } = setup(runInside, {
      tenant: { featureParams: { 'job.maxConcurrency': 2 } },
      store: { activeAhead: vi.fn(async () => 1), requeue },
    });
    await expect(execute(ENVELOPE)).resolves.toEqual({ done: true });
    expect(handler).toHaveBeenCalled();
    expect(requeue).not.toHaveBeenCalled();
  });

  it('排在上限之後 → 放回佇列（延後 5～10 秒），不執行 handler', async () => {
    const requeue = vi.fn(
      async (_name: string, _id: string, _delay: number) => 'requeued' as const,
    );
    const activeAhead = vi.fn(async () => 2);
    const { execute, handler } = setup(runInside, {
      tenant: { featureParams: { 'job.maxConcurrency': 2 } },
      store: { activeAhead, requeue },
    });
    await expect(execute(ENVELOPE)).resolves.toMatchObject({ skipped: 'TENANT_CONCURRENCY' });
    expect(handler).not.toHaveBeenCalled();
    expect(activeAhead).toHaveBeenCalledWith('t1', 'job-1');
    expect(requeue).toHaveBeenCalledWith('test.work', 'job-1', expect.any(Number));
    const delay = requeue.mock.calls[0]?.[2] ?? 0;
    expect(delay).toBeGreaterThanOrEqual(5);
    expect(delay).toBeLessThanOrEqual(10);
  });

  it('沒有覆寫時用預設上限 10', async () => {
    const requeue = vi.fn(async () => 'requeued' as const);
    const { execute, handler } = setup(runInside, {
      tenant: { featureParams: {} },
      store: { activeAhead: vi.fn(async () => 9), requeue },
    });
    await execute(ENVELOPE);
    expect(handler).toHaveBeenCalled();
    expect(requeue).not.toHaveBeenCalled();
  });

  it('租戶找不到 → 不判斷，交給 tenancy.run 回報', async () => {
    const activeAhead = vi.fn();
    const { execute } = setup(
      async () => {
        throw new AppException('TENANT_NOT_FOUND');
      },
      { store: { activeAhead } },
    );
    await expect(execute(ENVELOPE)).resolves.toEqual({ skipped: 'TENANT_NOT_FOUND' });
    expect(activeAhead).not.toHaveBeenCalled();
  });
});

describe('JobQueue：worker 的並行數（docs/architecture/backend/10-jobs.md §3）', () => {
  it('以工作類型的 concurrency 設定 pg-boss 的 localConcurrency（預設 1）', async () => {
    const { queue } = setupQueue();
    const work = vi.fn(async (_name: string, _options: object, _handler: unknown) => 'worker-id');
    (queue as unknown as { boss: { work: typeof work } }).boss.work = work;
    const start = (type: ReturnType<typeof defineJob>) =>
      (
        queue as unknown as {
          startWorker: (registration: { type: typeof type }) => Promise<void>;
        }
      ).startWorker({ type });

    await start(defineJob('test.single'));
    await start(defineJob('test.mail', { concurrency: 5 }));
    expect(work.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['test.single', { batchSize: 1, localConcurrency: 1 }],
      ['test.mail', { batchSize: 1, localConcurrency: 5 }],
    ]);
  });
});
