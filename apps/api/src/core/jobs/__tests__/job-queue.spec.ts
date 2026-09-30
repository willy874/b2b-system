import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import type { Database } from '../../database';
import { AppException } from '../../errors';
import type { Tenancy, TenantDirectory } from '../../tenant';
import { JobQueue } from '../job-queue';
import type { JobContext, JobEnvelope } from '../job-queue';
import { defineJob } from '../job-type';

const TYPE = defineJob<{ id: string }>('test.work');
const CONTEXT = { id: 'job-1', retryCount: 0, signal: new AbortController().signal } as JobContext;

/** 不啟動 pg-boss（建構時不連線）。 */
function setupQueue(run: Tenancy['run'] = vi.fn()) {
  const config = {
    get: vi.fn((key: string) =>
      key === 'PLATFORM_DATABASE_URL' ? 'postgres://u:p@127.0.0.1:1/x' : undefined,
    ),
  } as unknown as ConfigService<Env, true>;
  const tenancy = { run } as unknown as Tenancy;
  return { queue: new JobQueue(config, tenancy, {} as TenantDirectory, {} as Database) };
}

/** 只測 handler 的執行規則。 */
function setup(run: Tenancy['run']) {
  const { queue } = setupQueue(run);
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
