import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DrizzleQueryError } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import { withTransaction } from '../../database';
import type { Database, Transaction } from '../../database';
import { AppException } from '../../errors';
import { runInTenantContext } from '../../tenant';
import type { Tenancy, TenantContext, TenantDirectory, TenantRecord } from '../../tenant';
import type { UsageMeter } from '../../usage';
import { JobQueue } from '../job-queue';
import type { JobContext, JobEnvelope } from '../job-queue';
import type { JobStore } from '../job-store';
import { defineJob, HIGH_VOLUME_RETENTION_SECONDS } from '../job-type';
import type { JobType } from '../job-type';

/**
 * 假的 pg-boss：建構時不連線，記下每個呼叫。測的是 JobQueue 交給 pg-boss 的設定與資料，
 * pg-boss 本身的重試、逾時、排程在 test/jobs.spec.ts 以真的 Postgres 驗證。
 */
const { FakeBoss } = vi.hoisted(() => {
  class Boss {
    static last: Boss | undefined;
    readonly on = vi.fn();
    readonly start = vi.fn(async () => {});
    readonly stop = vi.fn(async (_options: object) => {});
    readonly getQueue = vi.fn(async (_name: string): Promise<object | null> => null);
    readonly createQueue = vi.fn(async (_name: string, _options: object) => {});
    readonly updateQueue = vi.fn(async (_name: string, _options: object) => {});
    readonly work = vi.fn(
      async (_name: string, _options: object, _handler: WorkHandler) => 'worker-id',
    );
    readonly getSchedules = vi.fn(async (): Promise<Array<{ name: string }>> => []);
    readonly schedule = vi.fn(
      async (_name: string, _cron: string, _data: unknown, _options: object) => {},
    );
    readonly unschedule = vi.fn(async (_name: string) => {});
    readonly send = vi.fn(
      async (_name: string, _data: object, _options: object): Promise<string | null> => 'job-id',
    );
    readonly insert = vi.fn(
      async (_name: string, _jobs: Array<Record<string, unknown>>): Promise<string[] | null> =>
        null,
    );
    readonly retry = vi.fn(async (_name: string, _id: string): Promise<object> => ({
      affected: 1,
    }));

    constructor(readonly options: Record<string, unknown>) {
      Boss.last = this;
    }
  }
  type WorkHandler = (jobs: Array<Record<string, unknown>>) => Promise<unknown>;
  return { FakeBoss: Boss };
});

vi.mock('pg-boss', () => ({ PgBoss: FakeBoss }));

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
  const usage = { count: vi.fn() };
  return {
    queue: new JobQueue(
      config,
      tenancy,
      directory,
      {} as Database,
      store,
      usage as unknown as UsageMeter,
    ),
    usage,
  };
}

/** 只測 handler 的執行規則。 */
function setup(run: Tenancy['run'], deps: QueueDeps = {}, type: JobType<{ id: string }> = TYPE) {
  const { queue, usage } = setupQueue(run, deps);
  const handler = vi.fn(async () => ({ done: true }));
  const execute = (envelope: JobEnvelope) =>
    (
      queue as unknown as {
        execute: (
          registration: { type: JobType<{ id: string }>; handler: typeof handler; cron: undefined },
          envelope: JobEnvelope,
          context: JobContext,
        ) => Promise<object | void>;
      }
    ).execute({ type, handler, cron: undefined }, envelope, CONTEXT);
  return { execute, handler, usage };
}

const ENVELOPE: JobEnvelope = { tenantId: 't1', payload: { id: 'x' } };

describe('JobQueue：租戶不能進入時的工作（docs/architecture/05-tenancy.md §10.2 D15）', () => {
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

  it('一般錯誤（不是 AppException）往外拋，交給 pg-boss 重試', async () => {
    const { execute } = setup(async () => {
      throw new Error('boom');
    });
    await expect(execute(ENVELOPE)).rejects.toThrow('boom');
  });

  it('可以進入 → 在租戶裡執行 handler', async () => {
    const { execute, handler } = setup(async (_id, fn) => fn());
    await expect(execute(ENVELOPE)).resolves.toEqual({ done: true });
    expect(handler).toHaveBeenCalledWith({ id: 'x' }, CONTEXT);
  });

  it('在租戶裡開始執行時記一次租戶用量（docs/architecture/05-tenancy.md §14.2 D11）', async () => {
    const { execute, usage } = setup(async (_id, fn) => fn());
    await execute(ENVELOPE);
    expect(usage.count).toHaveBeenCalledExactlyOnceWith('jobsExecuted');
  });

  it('租戶進不去 → 不記用量', async () => {
    const { execute, usage } = setup(async () => {
      throw new AppException('TENANT_NOT_FOUND');
    });
    await execute(ENVELOPE);
    expect(usage.count).not.toHaveBeenCalled();
  });
});

/** 租戶可以進入：直接執行 handler。 */
const runInside: Tenancy['run'] = async (_id, fn) => fn();

describe('JobQueue：租戶的同時執行上限（docs/architecture/05-tenancy.md §13.3 D9）', () => {
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
    expect(activeAhead).toHaveBeenCalledWith({
      tenantId: 't1',
      name: 'test.work',
      jobId: 'job-1',
      names: expect.arrayContaining(['jobs.outboxSweep']),
    });
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
  it('ignoreTenantConcurrency 的工作（驗證碼信）不判斷上限，直接執行（docs/architecture/backend/21-mfa.md §9.2）', async () => {
    const activeAhead = vi.fn(async () => 99);
    const { execute, handler } = setup(
      runInside,
      { tenant: { featureParams: { 'job.maxConcurrency': 1 } }, store: { activeAhead } },
      defineJob<{ id: string }>('test.urgent', { ignoreTenantConcurrency: true }),
    );
    await expect(execute(ENVELOPE)).resolves.toEqual({ done: true });
    expect(handler).toHaveBeenCalled();
    expect(activeAhead).not.toHaveBeenCalled();
  });

  it('exclusive 佇列已有一筆排隊而放不回去 → 以 skipped 結束並帶 conflict，不執行 handler', async () => {
    const { execute, handler } = setup(runInside, {
      tenant: { featureParams: { 'job.maxConcurrency': 1 } },
      store: { activeAhead: vi.fn(async () => 1), requeue: vi.fn(async () => 'conflict' as const) },
    });
    await expect(execute(ENVELOPE)).resolves.toEqual({
      skipped: 'TENANT_CONCURRENCY',
      result: 'conflict',
    });
    expect(handler).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// 以公開 API（register / onApplicationBootstrap / enqueue / relayOutbox / retry）測 JobQueue
// ---------------------------------------------------------------------------

type FakeBossInstance = InstanceType<typeof FakeBoss>;

const TENANT = {
  id: 't1',
  code: 'acme',
  features: [],
  flags: {},
  featureParams: {},
} as unknown as TenantContext;

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenantContext(TENANT, fn);
}

interface OutboxRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  options: { throttle?: { key: string; seconds: number }; startAfter?: string };
}

/** drizzle 條件的參數（例：`inArray` 的名單）。 */
function paramsOf(condition: SQL): unknown[] {
  return new PgDialect().sqlToQuery(condition).params;
}

/**
 * 租戶 DB 的假物件：每個交易依序回傳一批 outbox 的列（不管查詢條件，模擬資料庫每次都選到它們）。
 * `unregistered` 是定期清掃數「沒有註冊的列」的結果。
 */
function outboxDb(...batches: OutboxRow[][]) {
  const remove = vi.fn((_table: unknown) => ({ where: vi.fn(async (_where: unknown) => {}) }));
  const selectWhere = vi.fn((_condition: SQL) => {});
  const query = {
    where: (condition: SQL) => {
      selectWhere(condition);
      return query;
    },
    orderBy: () => query,
    limit: () => query,
    for: async () => batches.shift() ?? [],
  };
  const tx = { select: () => ({ from: () => query }), delete: remove };
  const transaction = vi.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const unregistered = vi.fn(async (): Promise<Array<{ name: string; count: number }>> => []);
  const db = {
    transaction,
    select: () => ({ from: () => ({ where: () => ({ groupBy: unregistered }) }) }),
  };
  return { db: db as unknown as Database, remove, transaction, selectWhere, unregistered };
}

/**
 * 記憶體裡的 outbox 表：查詢套用名稱條件（`inArray`）、依順序取 `limit` 筆；刪除移掉條件裡的 id。
 * 用來驗證「沒有註冊的列不擋住後面的列」。
 */
function outboxTable(initial: OutboxRow[]) {
  let rows = [...initial];
  const transaction = vi.fn(async (work: (t: unknown) => Promise<unknown>) => {
    let names: unknown[] = [];
    let take = Number.POSITIVE_INFINITY;
    const query = {
      where: (condition: SQL) => {
        names = paramsOf(condition);
        return query;
      },
      orderBy: () => query,
      limit: (count: number) => {
        take = count;
        return query;
      },
      for: async () => rows.filter((row) => names.includes(row.name)).slice(0, take),
    };
    const tx = {
      select: () => ({ from: () => query }),
      delete: () => ({
        where: async (condition: SQL) => {
          const ids = paramsOf(condition);
          rows = rows.filter((row) => !ids.includes(row.id));
        },
      }),
    };
    return work(tx);
  });
  return { db: { transaction } as unknown as Database, transaction, rows: () => rows };
}

interface HarnessOptions {
  workerEnabled?: boolean;
  sweepCron?: string;
  tenantDb?: Database;
  activeTenants?: Array<Pick<TenantRecord, 'id'>>;
  forEachActive?: Tenancy['forEachActive'];
}

function createQueue(options: HarnessOptions = {}) {
  const values: Record<string, unknown> = {
    PLATFORM_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    JOBS_WORKER_ENABLED: options.workerEnabled ?? true,
    JOBS_OUTBOX_SWEEP_CRON: options.sweepCron ?? '*/10 * * * *',
  };
  const config = { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService<
    Env,
    true
  >;
  const tenancy = {
    run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    forEachActive: options.forEachActive ?? vi.fn(async () => []),
  } as unknown as Tenancy;
  const directory = {
    findById: vi.fn(async () => undefined),
    listActive: vi.fn(async () => options.activeTenants ?? []),
  } as unknown as TenantDirectory;
  const queue = new JobQueue(
    config,
    tenancy,
    directory,
    options.tenantDb ?? outboxDb().db,
    {} as JobStore,
    { count: vi.fn() } as unknown as UsageMeter,
  );
  const boss = FakeBoss.last;
  if (!boss) throw new Error('pg-boss 沒有被建立');
  return { queue, boss };
}

function workerOf(boss: FakeBossInstance, name: string) {
  const call = boss.work.mock.calls.find(([queueName]) => queueName === name);
  if (!call) throw new Error(`${name} 沒有啟動 worker`);
  return call[2];
}

const SIGNAL = new AbortController().signal;
const job = (data: JobEnvelope | null) => ({ id: 'job-9', retryCount: 2, signal: SIGNAL, data });

const PLATFORM_TYPE = defineJob<{ id: string }>('test.platform', { scope: 'platform' });
const EXCLUSIVE_TYPE = defineJob<Record<string, never>>('test.exclusive', {
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 60 * 60,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JobQueue：建構與註冊（docs/architecture/backend/10-jobs.md §2、§5）', () => {
  it.each([
    [true, true],
    [false, false],
  ])('JOBS_WORKER_ENABLED=%s → pg-boss 的排程與維護 = %s', (workerEnabled, expected) => {
    const { boss } = createQueue({ workerEnabled });
    expect(boss.options).toMatchObject({ schedule: expected, supervise: expected });
  });

  it('監聽 pg-boss 的 error 事件（沒監聽會讓程序崩潰）', () => {
    const { boss } = createQueue();
    expect(boss.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('內建的 jobs.outboxSweep 以 JOBS_OUTBOX_SWEEP_CRON 註冊成平台工作', () => {
    const { queue } = createQueue({ sweepCron: '*/5 * * * *' });
    expect(queue.definitions()).toContainEqual({
      name: 'jobs.outboxSweep',
      cron: '*/5 * * * *',
      scope: 'platform',
    });
  });

  it('cron 是空字串 → 視為不排程（cron 為 null）', () => {
    const { queue } = createQueue({ sweepCron: '' });
    expect(queue.definitions()).toContainEqual({
      name: 'jobs.outboxSweep',
      cron: null,
      scope: 'platform',
    });
  });

  it('同一種工作註冊兩次 → 拋錯', () => {
    const { queue } = createQueue();
    queue.register(TYPE, vi.fn());
    expect(() => queue.register(TYPE, vi.fn())).toThrow(/已經註冊過/);
  });

  it('啟動之後才註冊 → 拋錯', async () => {
    const { queue } = createQueue({ workerEnabled: false });
    await queue.onApplicationBootstrap();
    expect(() => queue.register(TYPE, vi.fn())).toThrow(/onModuleInit/);
  });

  it('names() 與 definitions() 依名稱排序', () => {
    const { queue } = createQueue();
    queue.register(defineJob('zeta.run'), vi.fn());
    queue.register(defineJob('alpha.run'), vi.fn());
    expect(queue.names()).toEqual(['alpha.run', 'jobs.outboxSweep', 'zeta.run']);
    expect(queue.definitions().map((definition) => definition.name)).toEqual(queue.names());
  });

  it('isRegistered 只認得已註冊的工作', () => {
    const { queue } = createQueue();
    queue.register(TYPE, vi.fn());
    expect(queue.isRegistered(TYPE.name)).toBe(true);
    expect(queue.isRegistered('ghost.job')).toBe(false);
  });
});

describe('JobQueue：啟動時建立佇列、worker 與排程（docs/architecture/backend/10-jobs.md §3）', () => {
  it('新佇列：重試次數、退避起點與上限、逾時交給 pg-boss，指數退避；exclusive → stately', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    queue.register(EXCLUSIVE_TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.createQueue).toHaveBeenCalledWith('test.exclusive', {
      retryLimit: 3,
      retryDelay: 300,
      retryBackoff: true,
      retryDelayMax: 3600,
      expireInSeconds: 3600,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
      policy: 'stately',
    });
  });

  it('非 exclusive 的工作 → standard（每筆都執行）', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.createQueue).toHaveBeenCalledWith(
      'test.work',
      expect.objectContaining({ policy: 'standard', expireInSeconds: 15 * 60 }),
    );
  });

  it('佇列已存在 → 只更新可改的選項（policy 建立後不能改，不送 retryDelayMax）', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    boss.getQueue.mockResolvedValue({ name: 'existing' });
    queue.register(EXCLUSIVE_TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.createQueue).not.toHaveBeenCalled();
    expect(boss.updateQueue).toHaveBeenCalledWith('test.exclusive', {
      retryLimit: 3,
      retryDelay: 300,
      retryBackoff: true,
      expireInSeconds: 3600,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    });
  });

  it('高流量工作的保留期（deleteAfterSeconds）交給 pg-boss：新佇列與既有佇列都同步', async () => {
    const type = defineJob('test.burst', { deleteAfterSeconds: HIGH_VOLUME_RETENTION_SECONDS });
    const { queue, boss } = createQueue({ workerEnabled: false });
    boss.getQueue.mockImplementation(async (name: string) =>
      name === 'test.burst' ? { name } : null,
    );
    queue.register(type, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.updateQueue).toHaveBeenCalledWith(
      'test.burst',
      expect.objectContaining({ deleteAfterSeconds: 24 * 60 * 60 }),
    );
  });

  it('JOBS_WORKER_ENABLED=false → 建立佇列（仍可入列），不啟動 worker、不同步排程', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.createQueue).toHaveBeenCalledTimes(2);
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.getSchedules).not.toHaveBeenCalled();
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('JOBS_WORKER_ENABLED=true → 每種已註冊的工作各啟動一個 worker', async () => {
    const { queue, boss } = createQueue();
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.work.mock.calls.map(([name]) => name).toSorted()).toEqual([
      'jobs.outboxSweep',
      'test.work',
    ]);
  });

  it('有 cron 的工作以 UTC 排程', async () => {
    const { queue, boss } = createQueue({ sweepCron: '' });
    queue.register(EXCLUSIVE_TYPE, vi.fn(), { cron: '30 3 * * *' });
    await queue.onApplicationBootstrap();
    expect(boss.schedule).toHaveBeenCalledExactlyOnceWith('test.exclusive', '30 3 * * *', null, {
      tz: 'UTC',
    });
  });

  it('cron 改成空字串而之前有排程 → 移除排程（以程式碼為準）', async () => {
    const { queue, boss } = createQueue({ sweepCron: '' });
    boss.getSchedules.mockResolvedValue([{ name: 'jobs.outboxSweep' }]);
    await queue.onApplicationBootstrap();
    expect(boss.unschedule).toHaveBeenCalledExactlyOnceWith('jobs.outboxSweep');
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('沒有 cron 也沒有舊排程 → 不呼叫 unschedule', async () => {
    const { queue, boss } = createQueue({ sweepCron: '' });
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    expect(boss.unschedule).not.toHaveBeenCalled();
  });
});

describe('JobQueue：關機（docs/architecture/backend/10-jobs.md §5）', () => {
  it('沒啟動過 → 不呼叫 pg-boss 的 stop', async () => {
    const { queue, boss } = createQueue();
    await queue.onApplicationShutdown();
    expect(boss.stop).not.toHaveBeenCalled();
  });

  it('啟動過 → graceful 停止，最多等 30 秒', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    await queue.onApplicationBootstrap();
    await queue.onApplicationShutdown();
    expect(boss.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: 30_000 });
  });

  it('停止之後再呼叫一次不會重複 stop', async () => {
    const { queue, boss } = createQueue({ workerEnabled: false });
    await queue.onApplicationBootstrap();
    await queue.onApplicationShutdown();
    await queue.onApplicationShutdown();
    expect(boss.stop).toHaveBeenCalledOnce();
  });
});

describe('JobQueue.enqueue（docs/architecture/backend/10-jobs.md §4）', () => {
  it('沒註冊的工作 → 拋 Error，不送進佇列', async () => {
    const { queue, boss } = createQueue();
    await expect(inTenant(() => queue.enqueue(TYPE, { id: 'x' }))).rejects.toThrow(
      /沒有註冊 handler/,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('平台工作帶租戶的交易 → 拋錯', async () => {
    const { queue } = createQueue();
    queue.register(PLATFORM_TYPE, vi.fn());
    await expect(
      queue.enqueue(PLATFORM_TYPE, { id: 'x' }, { tx: {} as Transaction }),
    ).rejects.toThrow(/不能在租戶的交易裡入列/);
  });

  it('平台工作 → 信封的 tenantId 為 null，不需要租戶脈絡', async () => {
    const { queue, boss } = createQueue();
    queue.register(PLATFORM_TYPE, vi.fn());
    await expect(queue.enqueue(PLATFORM_TYPE, { id: 'x' })).resolves.toBe('job-id');
    expect(boss.send).toHaveBeenCalledWith(
      'test.platform',
      { tenantId: null, payload: { id: 'x' } },
      {
        id: undefined,
        singletonKey: undefined,
        singletonSeconds: undefined,
        startAfter: undefined,
        group: undefined,
      },
    );
  });

  it('exclusive 的平台工作 → singletonKey 是 platform', async () => {
    const { queue, boss } = createQueue();
    const type = defineJob('test.platformOnce', { scope: 'platform', exclusive: true });
    queue.register(type, vi.fn());
    await queue.enqueue(type, {});
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({ singletonKey: 'platform' });
  });

  it('租戶工作沒有租戶脈絡 → TENANT_NOT_FOUND', async () => {
    const { queue } = createQueue();
    queue.register(TYPE, vi.fn());
    await expect(queue.enqueue(TYPE, { id: 'x' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('租戶工作 → 信封帶目前的租戶 id，pg-boss 的 group 也是租戶 id（計數走 group_id 的索引）', async () => {
    const { queue, boss } = createQueue();
    queue.register(TYPE, vi.fn());
    await inTenant(() => queue.enqueue(TYPE, { id: 'x' }));
    expect(boss.send.mock.calls[0]?.[1]).toEqual({ tenantId: 't1', payload: { id: 'x' } });
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({ group: { id: 't1' } });
  });

  it('throttle → singletonKey 以租戶區分（<租戶>:<key>）並帶時間窗', async () => {
    const { queue, boss } = createQueue();
    queue.register(TYPE, vi.fn());
    await inTenant(() =>
      queue.enqueue(TYPE, { id: 'x' }, { throttle: { key: 'reset:u-1', seconds: 60 } }),
    );
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({
      singletonKey: 't1:reset:u-1',
      singletonSeconds: 60,
    });
  });

  it('throttle 在時間窗內被擋下 → 回傳 null', async () => {
    const { queue, boss } = createQueue();
    boss.send.mockResolvedValueOnce(null);
    queue.register(TYPE, vi.fn());
    await expect(
      inTenant(() => queue.enqueue(TYPE, { id: 'x' }, { throttle: { key: 'k', seconds: 60 } })),
    ).resolves.toBeNull();
  });

  it('exclusive 的租戶工作 → singletonKey 是租戶 id（一個租戶不擋另一個租戶）', async () => {
    const { queue, boss } = createQueue();
    queue.register(EXCLUSIVE_TYPE, vi.fn());
    await inTenant(() => queue.enqueue(EXCLUSIVE_TYPE, {}));
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({ singletonKey: 't1' });
  });

  it('exclusive 又帶 throttle → 以 throttle 的 key 為準', async () => {
    const { queue, boss } = createQueue();
    queue.register(EXCLUSIVE_TYPE, vi.fn());
    await inTenant(() =>
      queue.enqueue(EXCLUSIVE_TYPE, {}, { throttle: { key: 'k', seconds: 30 } }),
    );
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({ singletonKey: 't1:k' });
  });

  it('startAfter 原樣交給 pg-boss（延後執行）', async () => {
    const { queue, boss } = createQueue();
    queue.register(TYPE, vi.fn());
    const startAfter = new Date('2026-11-01T00:00:00.000Z');
    await inTenant(() => queue.enqueue(TYPE, { id: 'x' }, { startAfter }));
    expect(boss.send.mock.calls[0]?.[2]).toMatchObject({ startAfter });
  });
});

/** 業務交易：insert 進 outbox 回傳 outbox-1（多列的 INSERT 不取回 id）。 */
function businessDb() {
  const values = vi.fn((_rows: Record<string, unknown> | Array<Record<string, unknown>>) =>
    Object.assign(Promise.resolve(), { returning: async () => [{ id: 'outbox-1' }] }),
  );
  const insert = vi.fn(() => ({ values }));
  // 每個交易是不同的物件（同一個交易只登記一次搬移，以物件區分）
  const db = {
    transaction: async (work: (t: unknown) => Promise<unknown>) => work({ insert }),
  } as unknown as Database;
  return { db, values, insert };
}

describe('JobQueue.enqueue 帶 tx：outbox（docs/architecture/backend/10-jobs.md §4.1）', () => {
  const ROW: OutboxRow = {
    id: 'outbox-1',
    name: 'test.work',
    data: { id: 'x' },
    options: { throttle: { key: 'k', seconds: 60 }, startAfter: '2026-11-01T00:00:00.000Z' },
  };

  it('交易內只寫 outbox（名稱、資料、選項）並回傳 outbox 的 id；提交前不送進佇列', async () => {
    const { queue, boss } = createQueue({ tenantDb: outboxDb().db });
    queue.register(TYPE, vi.fn());
    const { db, values } = businessDb();
    const startAfter = new Date('2026-11-01T00:00:00.000Z');

    const id = await inTenant(() =>
      withTransaction(db, async (tx) => {
        const enqueued = await queue.enqueue(
          TYPE,
          { id: 'x' },
          { tx, throttle: { key: 'k', seconds: 60 }, startAfter },
        );
        expect(boss.send).not.toHaveBeenCalled();
        return enqueued;
      }),
    );
    expect(id).toBe('outbox-1');
    expect(values).toHaveBeenCalledWith({
      name: 'test.work',
      data: { id: 'x' },
      options: { throttle: { key: 'k', seconds: 60 }, startAfter: '2026-11-01T00:00:00.000Z' },
    });
  });

  it('提交後搬進佇列：以 outbox 的 id 當工作 id、帶租戶與選項，並刪除 outbox 的列', async () => {
    const tenant = outboxDb([ROW]);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const { db } = businessDb();

    await inTenant(() => withTransaction(db, (tx) => queue.enqueue(TYPE, { id: 'x' }, { tx })));
    expect(boss.insert).toHaveBeenCalledExactlyOnceWith('test.work', [
      {
        data: { tenantId: 't1', payload: { id: 'x' } },
        id: 'outbox-1',
        singletonKey: 't1:k',
        singletonSeconds: 60,
        startAfter: new Date('2026-11-01T00:00:00.000Z'),
        group: { id: 't1' },
      },
    ]);
    expect(boss.send).not.toHaveBeenCalled();
    expect(tenant.remove).toHaveBeenCalledOnce();
  });

  it('同一個交易入列 3 筆：提交後只搬移一次（不為每一筆各開一個交易）', async () => {
    const tenant = outboxDb([ROW]);
    const { queue } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const { db } = businessDb();

    await inTenant(() =>
      withTransaction(db, async (tx) => {
        await queue.enqueue(TYPE, { id: 'a' }, { tx });
        await queue.enqueue(TYPE, { id: 'b' }, { tx });
        await queue.enqueueMany(TYPE, [{ data: { id: 'c' } }], { tx });
      }),
    );
    expect(tenant.transaction).toHaveBeenCalledOnce();
  });

  it('不同的交易各自搬移一次', async () => {
    const tenant = outboxDb([ROW], [ROW]);
    const { queue } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const { db } = businessDb();

    await inTenant(async () => {
      await withTransaction(db, (tx) => queue.enqueue(TYPE, { id: 'a' }, { tx }));
      await withTransaction(db, (tx) => queue.enqueue(TYPE, { id: 'b' }, { tx }));
    });
    expect(tenant.transaction).toHaveBeenCalledTimes(2);
  });

  it('提交後的搬移失敗 → 業務交易照常完成（等定期清掃補搬）', async () => {
    const failing = {
      transaction: vi.fn(async () => {
        throw new Error('tenant db down');
      }),
    } as unknown as Database;
    const { queue } = createQueue({ tenantDb: failing });
    queue.register(TYPE, vi.fn());
    const { db } = businessDb();

    await expect(
      inTenant(() => withTransaction(db, (tx) => queue.enqueue(TYPE, { id: 'x' }, { tx }))),
    ).resolves.toBe('outbox-1');
  });
});

const outboxRow = (id: string, name = 'test.work'): OutboxRow => ({
  id,
  name,
  data: { id },
  options: {},
});

describe('JobQueue.enqueueMany（docs/architecture/backend/10-jobs.md §4.1）', () => {
  it('一條多列 INSERT 寫進 outbox（名稱、資料、延後時間），提交後搬移一次', async () => {
    const tenant = outboxDb([]);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const { db, values, insert } = businessDb();
    const startAfter = new Date('2026-11-01T00:00:00.000Z');

    await inTenant(() =>
      withTransaction(db, (tx) =>
        queue.enqueueMany(TYPE, [{ data: { id: 'a' } }, { data: { id: 'b' }, startAfter }], { tx }),
      ),
    );
    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledExactlyOnceWith([
      { name: 'test.work', data: { id: 'a' }, options: { startAfter: undefined } },
      {
        name: 'test.work',
        data: { id: 'b' },
        options: { startAfter: '2026-11-01T00:00:00.000Z' },
      },
    ]);
    expect(boss.send).not.toHaveBeenCalled();
    expect(tenant.transaction).toHaveBeenCalledOnce();
  });

  it('超過 1000 筆時分段寫入（一條語句的參數有上限）', async () => {
    const { queue } = createQueue({ tenantDb: outboxDb().db });
    queue.register(TYPE, vi.fn());
    const { db, values } = businessDb();
    const items = Array.from({ length: 2500 }, (_, index) => ({ data: { id: `j${index}` } }));

    await inTenant(() => withTransaction(db, (tx) => queue.enqueueMany(TYPE, items, { tx })));
    expect(values.mock.calls.map(([rows]) => (rows as unknown[]).length)).toEqual([
      1000, 1000, 500,
    ]);
  });

  it('沒有任何一筆 → 不寫 outbox、不登記搬移', async () => {
    const tenant = outboxDb();
    const { queue } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const { db, insert } = businessDb();

    await inTenant(() => withTransaction(db, (tx) => queue.enqueueMany(TYPE, [], { tx })));
    expect(insert).not.toHaveBeenCalled();
    expect(tenant.transaction).not.toHaveBeenCalled();
  });

  it('平台工作 → 拋錯；沒註冊 → 拋錯；沒有租戶脈絡 → TENANT_NOT_FOUND', async () => {
    const { queue } = createQueue();
    queue.register(PLATFORM_TYPE, vi.fn());
    const tx = {} as Transaction;
    await expect(queue.enqueueMany(PLATFORM_TYPE, [{ data: { id: 'x' } }], { tx })).rejects.toThrow(
      /不能在租戶的交易裡入列/,
    );
    await expect(queue.enqueueMany(TYPE, [{ data: { id: 'x' } }], { tx })).rejects.toThrow(
      /沒有註冊 handler/,
    );
    queue.register(TYPE, vi.fn());
    await expect(queue.enqueueMany(TYPE, [{ data: { id: 'x' } }], { tx })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });
});

describe('JobQueue.relayOutbox（docs/architecture/backend/10-jobs.md §4.1）', () => {
  it('沒有租戶脈絡 → TENANT_NOT_FOUND', async () => {
    const { queue } = createQueue();
    await expect(queue.relayOutbox()).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('只選已註冊的工作名稱（沒有註冊的列不選、不刪）', async () => {
    const tenant = outboxDb([]);
    const { queue } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    await inTenant(() => queue.relayOutbox());
    const [condition] = tenant.selectWhere.mock.calls[0] ?? [];
    expect(paramsOf(condition as SQL).toSorted()).toEqual(['jobs.outboxSweep', 'test.work']);
  });

  it('沒有註冊 handler 的列留在 outbox：不送、不刪', async () => {
    const tenant = outboxDb([outboxRow('o-1', 'retired.job')]);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(0);
    expect(boss.insert).not.toHaveBeenCalled();
    expect(tenant.remove).not.toHaveBeenCalled();
  });

  it('資料庫每次都選到同一批 100 列沒有註冊的工作 → 一輪就結束，不空轉', async () => {
    const retired = Array.from({ length: 100 }, (_, index) =>
      outboxRow(`r-${index}`, 'retired.job'),
    );
    const tenant = outboxDb(retired, retired, retired, retired, retired);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(0);
    expect(tenant.transaction).toHaveBeenCalledOnce();
    expect(boss.insert).not.toHaveBeenCalled();
    expect(tenant.remove).not.toHaveBeenCalled();
  });

  it('最舊的 100 列都沒有註冊、後面 1 列有註冊 → 那 1 列照常送出，沒有註冊的留著', async () => {
    const retired = Array.from({ length: 100 }, (_, index) =>
      outboxRow(`r-${index}`, 'retired.job'),
    );
    const table = outboxTable([...retired, outboxRow('o-1')]);
    const { queue, boss } = createQueue({ tenantDb: table.db });
    queue.register(TYPE, vi.fn());
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(1);
    expect(boss.insert).toHaveBeenCalledExactlyOnceWith('test.work', [
      expect.objectContaining({ id: 'o-1', data: { tenantId: 't1', payload: { id: 'o-1' } } }),
    ]);
    expect(table.rows()).toHaveLength(100);
    expect(table.transaction).toHaveBeenCalledOnce();
  });

  it('同一批依工作名稱分組，每組一次批次送出；只刪送出的列', async () => {
    const other = defineJob<{ id: string }>('test.other');
    const tenant = outboxDb([outboxRow('o-1'), outboxRow('o-2', 'test.other'), outboxRow('o-3')]);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    queue.register(other, vi.fn());
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(3);
    expect(boss.insert.mock.calls.map(([name, jobs]) => [name, jobs.map((j) => j.id)])).toEqual([
      ['test.work', ['o-1', 'o-3']],
      ['test.other', ['o-2']],
    ]);
    expect(boss.send).not.toHaveBeenCalled();
    expect(tenant.remove).toHaveBeenCalledOnce();
  });

  it('一批 100 筆滿了就再開一個交易取下一批，直到不滿為止；一批只送出一次，不是 100 次 send', async () => {
    const full = Array.from({ length: 100 }, (_, index) => outboxRow(`o-${index}`));
    const tenant = outboxDb(full, [outboxRow('o-last')]);
    const { queue, boss } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(101);
    expect(tenant.transaction).toHaveBeenCalledTimes(2);
    expect(boss.insert.mock.calls.map(([, jobs]) => jobs.length)).toEqual([100, 1]);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('signal 已中止 → 不再開新的一批', async () => {
    const tenant = outboxDb([outboxRow('o-1')]);
    const { queue } = createQueue({ tenantDb: tenant.db });
    queue.register(TYPE, vi.fn());
    const controller = new AbortController();
    controller.abort();
    await expect(inTenant(() => queue.relayOutbox(controller.signal))).resolves.toBe(0);
    expect(tenant.transaction).not.toHaveBeenCalled();
  });

  it('outbox 是空的 → 0，一個交易就結束', async () => {
    const tenant = outboxDb([]);
    const { queue } = createQueue({ tenantDb: tenant.db });
    await expect(inTenant(() => queue.relayOutbox())).resolves.toBe(0);
    expect(tenant.transaction).toHaveBeenCalledOnce();
  });
});

describe('JobQueue.retry（docs/architecture/backend/10-jobs.md §6）', () => {
  it.each([
    [{ affected: 1 }, true],
    [{ affected: 0 }, false],
    [{}, false],
  ])('pg-boss 回傳 %j → %s', async (response, expected) => {
    const { queue, boss } = createQueue();
    boss.retry.mockResolvedValueOnce(response);
    await expect(queue.retry('test.work', 'job-1')).resolves.toBe(expected);
    expect(boss.retry).toHaveBeenCalledWith('test.work', 'job-1');
  });
});

describe('JobQueue：worker 執行工作（docs/architecture/backend/10-jobs.md §2、§3）', () => {
  it('取到空的批次 → 不呼叫 handler', async () => {
    const { queue, boss } = createQueue();
    const handler = vi.fn();
    queue.register(PLATFORM_TYPE, handler);
    await queue.onApplicationBootstrap();
    await expect(workerOf(boss, 'test.platform')([])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('平台工作 → handler 拿到 payload 與 id／重試次數／signal，回傳值成為 output', async () => {
    const { queue, boss } = createQueue();
    const handler = vi.fn(async () => ({ processed: 3 }));
    queue.register(PLATFORM_TYPE, handler);
    await queue.onApplicationBootstrap();
    await expect(
      workerOf(boss, 'test.platform')([job({ tenantId: null, payload: { id: 'x' } })]),
    ).resolves.toEqual({ processed: 3 });
    expect(handler).toHaveBeenCalledWith(
      { id: 'x' },
      { id: 'job-9', retryCount: 2, signal: SIGNAL },
    );
  });

  it('排程觸發的平台工作（沒有信封）→ handler 拿到空物件', async () => {
    const { queue, boss } = createQueue();
    const handler = vi.fn(async () => {});
    queue.register(PLATFORM_TYPE, handler);
    await queue.onApplicationBootstrap();
    await workerOf(boss, 'test.platform')([job(null)]);
    expect(handler).toHaveBeenCalledWith({}, expect.anything());
  });

  it('handler 拋錯 → 往外拋（pg-boss 記錄失敗並依 retryLimit 重試）', async () => {
    const { queue, boss } = createQueue();
    queue.register(PLATFORM_TYPE, async () => {
      throw new Error('smtp down');
    });
    await queue.onApplicationBootstrap();
    await expect(
      workerOf(boss, 'test.platform')([job({ tenantId: null, payload: { id: 'x' } })]),
    ).rejects.toThrow('smtp down');
  });

  it('handler 拋資料庫的查詢錯誤 → 交給 pg-boss 的錯誤不含參數（存成 output，job:read 看得到）', async () => {
    const { queue, boss } = createQueue();
    queue.register(PLATFORM_TYPE, async () => {
      throw new DrizzleQueryError(
        'update "users" set "password_hash" = $1 where "id" = $2',
        ['$argon2id$secret', 'u1'],
        Object.assign(new Error('deadlock detected'), { code: '40P01', detail: 'secret detail' }),
      );
    });
    await queue.onApplicationBootstrap();
    const thrown = await workerOf(
      boss,
      'test.platform',
    )([job({ tenantId: null, payload: { id: 'x' } })]).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      name: 'DbQueryError',
      query: 'update "users" set "password_hash" = $1 where "id" = $2',
      cause: { code: '40P01' },
    });
    expect(thrown).not.toHaveProperty('params');
    expect(JSON.stringify(thrown)).not.toContain('secret');
    expect((thrown as Error).message).not.toContain('secret');
    expect((thrown as Error).stack).not.toContain('secret');
  });

  it('排程觸發的租戶工作（沒有租戶）→ 每個 active 租戶各入列一筆，不執行 handler', async () => {
    const { queue, boss } = createQueue({ activeTenants: [{ id: 't1' }, { id: 't2' }] });
    const handler = vi.fn();
    queue.register(EXCLUSIVE_TYPE, handler, { cron: '0 * * * *' });
    await queue.onApplicationBootstrap();

    await expect(workerOf(boss, 'test.exclusive')([job(null)])).resolves.toEqual({ tenants: 2 });
    expect(handler).not.toHaveBeenCalled();
    expect(
      boss.send.mock.calls.map(([name, envelope, options]) => [name, envelope, options]),
    ).toEqual([
      [
        'test.exclusive',
        { tenantId: 't1', payload: {} },
        expect.objectContaining({ singletonKey: 't1', group: { id: 't1' } }),
      ],
      [
        'test.exclusive',
        { tenantId: 't2', payload: {} },
        expect.objectContaining({ singletonKey: 't2', group: { id: 't2' } }),
      ],
    ]);
  });

  it('jobs.outboxSweep：走遍每個 active 租戶補搬，回傳搬移筆數與失敗的租戶；把工作的 signal 交給 forEachActive', async () => {
    const tenant = outboxDb([{ id: 'o-1', name: 'test.work', data: {}, options: {} }]);
    const forEachActive = vi.fn(async (fn: (context: TenantContext) => Promise<void>) => {
      await runInTenantContext(TENANT, () => fn(TENANT));
      return ['broken'];
    });
    const { queue, boss } = createQueue({ tenantDb: tenant.db, forEachActive });
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();

    await expect(workerOf(boss, 'jobs.outboxSweep')([job(null)])).resolves.toEqual({
      moved: 1,
      failedTenants: ['broken'],
      unregistered: 0,
    });
    expect(forEachActive).toHaveBeenCalledWith(expect.any(Function), { signal: SIGNAL });
  });

  it('jobs.outboxSweep：有沒有註冊的列 → 每個租戶記一筆 warn（名稱與筆數），不逐列記錄', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const tenant = outboxDb([]);
    tenant.unregistered.mockResolvedValue([
      { name: 'retired.job', count: 120 },
      { name: 'renamed.job', count: 3 },
    ]);
    const forEachActive = vi.fn(async (fn: (context: TenantContext) => Promise<void>) => {
      await runInTenantContext(TENANT, () => fn(TENANT));
      return [];
    });
    const { queue, boss } = createQueue({ tenantDb: tenant.db, forEachActive });
    await queue.onApplicationBootstrap();

    await expect(workerOf(boss, 'jobs.outboxSweep')([job(null)])).resolves.toEqual({
      moved: 0,
      failedTenants: [],
      unregistered: 123,
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      {
        tenant: 'acme',
        jobs: [
          { name: 'retired.job', count: 120 },
          { name: 'renamed.job', count: 3 },
        ],
      },
      expect.stringContaining('沒有註冊 handler'),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('jobs.outboxSweep：工作逾時（signal 中止）→ 不再搬下一批', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const tenant = outboxDb([outboxRow('o-1')]);
    const forEachActive = vi.fn(async (fn: (context: TenantContext) => Promise<void>) => {
      await runInTenantContext(TENANT, () => fn(TENANT));
      return [];
    });
    const { queue, boss } = createQueue({ tenantDb: tenant.db, forEachActive });
    queue.register(TYPE, vi.fn());
    await queue.onApplicationBootstrap();
    const controller = new AbortController();
    controller.abort();

    await expect(
      workerOf(boss, 'jobs.outboxSweep')([{ ...job(null), signal: controller.signal }]),
    ).resolves.toMatchObject({ moved: 0 });
    expect(tenant.transaction).not.toHaveBeenCalled();
  });
});
