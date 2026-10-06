import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, inArray, notInArray, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { JobInsert, Queue } from 'pg-boss';

import { jobOutbox } from '@/db/schema';
import type { JobOutboxRow } from '@/db/schema';

import type { Env } from '../config';
import { afterCommit, TENANT_DB, withTransaction } from '../database';
import type { Database, Transaction } from '../database';
import { AppException, redactDbError } from '../errors';
import {
  JOB_MAX_CONCURRENCY_PARAM,
  requireTenant,
  resolveTenantFeatureParam,
  Tenancy,
  TenantDirectory,
} from '../tenant';
import { JOB_SCHEMA, JobStore } from './job-store';
import { defineJob } from './job-type';
import type { JobType } from './job-type';

/**
 * pg-boss 裡存的工作資料：屬於哪個租戶（平台工作是 null）＋ 入列時的資料
 * （docs/architecture/05-tenancy.md §10.2 D15）。只放 id 之類的參照，不放租戶的個人資料。
 */
export interface JobEnvelope<TData extends object = object> {
  tenantId: string | null;
  payload: TData;
}

/** 補救交易提交後沒搬成的 outbox（程序剛好在提交與搬移之間當掉）。 */
const OUTBOX_SWEEP_JOB = defineJob<Record<string, never>>('jobs.outboxSweep', {
  scope: 'platform',
  exclusive: true,
  retryLimit: 0,
  expireInSeconds: 5 * 60,
});

const OUTBOX_BATCH = 100;

/** `enqueueMany` 一條 INSERT 最多幾列（每列 3 個參數，遠低於 Postgres 一個語句 65535 個參數的上限）。 */
const OUTBOX_INSERT_CHUNK = 1000;

/**
 * 租戶的同時執行數已滿時，放回佇列後隔多久再被取到（秒）：固定的下限加上隨機的抖動，
 * 同時被放回的幾筆不會在同一刻一起回來又一起被放回（docs/architecture/05-tenancy.md §13.3 D9）。
 */
const TENANT_BUSY_DELAY_SECONDS = 5;
const TENANT_BUSY_JITTER_SECONDS = 5;

/** handler 拿到的執行資訊。 */
export interface JobContext {
  id: string;
  /** 第幾次重試（第一次執行是 0）。 */
  retryCount: number;
  /** 程序關閉或工作逾時時中止；長時間的 handler 應該傳給下游或定期檢查。 */
  signal: AbortSignal;
}

/** 回傳的物件會存成工作的 `output`，管理頁看得到（例：這一輪處理了幾筆）。 */
export type JobHandler<TData extends object> = (
  data: TData,
  context: JobContext,
) => Promise<object | void>;

export interface RegisterJobOptions {
  /** cron（UTC）；有值就依排程入列，空字串或沒給代表不排程（並移除之前的排程）。 */
  cron?: string;
}

export interface EnqueueOptions {
  /**
   * 業務交易：入列與資料一起提交或一起回滾（docs/architecture/backend/10-jobs.md §9.2 D2）。佇列在平台 DB，
   * 所以交易內先寫租戶 DB 的 `job_outbox`，提交後才搬進佇列（docs/architecture/05-tenancy.md §10.2 D15）。
   */
  tx?: Transaction;
  /**
   * 節流：同一個 `key` 在同一個 `seconds` 秒的時間窗內只入列一筆，其餘回傳 `null`
   * （pg-boss 的 singletonKey ＋ singletonSeconds；單獨的 singletonKey 在 standard 佇列不起作用）。
   */
  throttle?: { key: string; seconds: number };
  startAfter?: Date;
}

/** `enqueueMany` 的一筆：資料與這一筆的延後時間。 */
export interface EnqueueManyItem<TData extends object> {
  data: TData;
  startAfter?: Date;
}

interface Registration {
  type: JobType<object>;
  handler: JobHandler<object>;
  cron: string | undefined;
}

/** 交給 pg-boss 的工作選項（`send` 與搬移時的批次 `insert` 共用）。 */
type BossJobOptions = Pick<
  JobInsert,
  'id' | 'singletonKey' | 'singletonSeconds' | 'startAfter' | 'group'
>;

/**
 * 背景工作佇列（docs/architecture/backend/10-jobs.md）。底層是 pg-boss；模組只認識這個類別，
 * 換掉 pg-boss 不影響模組（docs/architecture/backend/10-jobs.md §9）。佇列在平台 DB，一套 worker 服務所有租戶：
 * 租戶的工作帶著 `tenantId`，handler 在那個租戶的脈絡裡執行（docs/architecture/05-tenancy.md §10.2 D15）。
 *
 * 模組在 `onModuleInit` 呼叫 `register()`；`onApplicationBootstrap` 時統一建立佇列、
 * 啟動 worker 與排程——所以入列只能在啟動完成之後（HTTP 請求、其他工作裡）。
 */
@Injectable()
export class JobQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobQueue.name);
  private readonly boss: PgBoss;
  private readonly workerEnabled: boolean;
  private readonly registrations = new Map<string, Registration>();
  /** 已登記提交後搬移的交易：一個交易入列幾筆都只搬一次。 */
  private readonly relayScheduled = new WeakSet<Transaction>();
  private started = false;

  constructor(
    config: ConfigService<Env, true>,
    private readonly tenancy: Tenancy,
    private readonly directory: TenantDirectory,
    @Inject(TENANT_DB) private readonly tenantDb: Database,
    private readonly store: JobStore,
  ) {
    this.workerEnabled = config.get('JOBS_WORKER_ENABLED', { infer: true });
    this.boss = new PgBoss({
      connectionString: config.get('PLATFORM_DATABASE_URL', { infer: true }),
      schema: JOB_SCHEMA,
      application_name: 'b2b-system-jobs',
      // pg-boss 自己的連線池（它用 `pg`）
      max: 4,
      // 排程與維護（逾時、清除過期工作）只在執行工作的程序跑
      schedule: this.workerEnabled,
      supervise: this.workerEnabled,
    });
    // 沒有監聽 error 的 EventEmitter 會讓程序直接崩潰；pg-boss 的背景迴圈錯誤會自己重試
    this.boss.on('error', (error) => this.logger.error({ err: error }, 'pg-boss 背景作業失敗'));
    this.register(OUTBOX_SWEEP_JOB, (_data, { signal }) => this.sweepOutboxes(signal), {
      cron: config.get('JOBS_OUTBOX_SWEEP_CRON', { infer: true }),
    });
  }

  /** 註冊一種工作的 handler；同一種工作只能註冊一次。 */
  register<TData extends object>(
    type: JobType<TData>,
    handler: JobHandler<TData>,
    options: RegisterJobOptions = {},
  ): void {
    if (this.started) throw new Error(`工作 ${type.name} 必須在啟動前（onModuleInit）註冊`);
    if (this.registrations.has(type.name)) throw new Error(`工作 ${type.name} 已經註冊過 handler`);
    this.registrations.set(type.name, {
      type,
      // 型別由 JobType<TData> 綁定：入列端與 handler 用的是同一個 TData
      handler: handler as JobHandler<object>,
      cron: options.cron || undefined,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.start();
    this.started = true;
    for (const registration of this.registrations.values()) {
      // oxlint-disable-next-line no-await-in-loop -- 佇列數量少，依序建立讓錯誤訊息對得上是哪一個
      await this.ensureQueue(registration.type);
    }
    if (!this.workerEnabled) {
      this.logger.log(`背景工作：只入列、不執行（${this.registrations.size} 種）`);
      return;
    }
    for (const registration of this.registrations.values()) {
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await this.startWorker(registration);
    }
    await this.syncSchedules();
    this.logger.log(`背景工作：已啟動 ${this.registrations.size} 種工作的 worker`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    // graceful：等執行中的工作結束（最多 30 秒），逾時的由下一個程序在 expireInSeconds 後重試
    await this.boss.stop({ graceful: true, timeout: 30_000 });
    this.started = false;
  }

  /**
   * 入列；回傳工作 id。被 `throttle` 擋下時回傳 `null`。租戶的工作帶目前的租戶（沒有租戶脈絡時拋錯）；
   * 帶 `tx` 時先寫 outbox，回傳的 id 在提交後就是佇列裡的工作 id。
   */
  async enqueue<TData extends object>(
    type: JobType<TData>,
    data: TData,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    this.assertRegistered(type.name);
    if (type.options.scope === 'platform') {
      if (options.tx) throw new Error(`平台工作 ${type.name} 不能在租戶的交易裡入列`);
      return this.send(type, { tenantId: null, payload: data }, options);
    }
    const tenant = requireTenant();
    if (!options.tx) return this.send(type, { tenantId: tenant.id, payload: data }, options);

    const [row] = await options.tx
      .insert(jobOutbox)
      .values({
        name: type.name,
        data: data as Record<string, unknown>,
        options: { throttle: options.throttle, startAfter: options.startAfter?.toISOString() },
      })
      .returning({ id: jobOutbox.id });
    this.relayAfterCommit(options.tx);
    return row?.id ?? null;
  }

  /**
   * 同一種租戶工作在業務交易內一次入列多筆（例：一個事件 × 每位使用者）：outbox 以多列 INSERT 寫入，
   * 提交後與同一個交易裡的其他入列共用一次搬移（docs/architecture/backend/10-jobs.md §4.1）。
   */
  async enqueueMany<TData extends object>(
    type: JobType<TData>,
    items: ReadonlyArray<EnqueueManyItem<TData>>,
    options: { tx: Transaction },
  ): Promise<void> {
    this.assertRegistered(type.name);
    if (type.options.scope === 'platform') {
      throw new Error(`平台工作 ${type.name} 不能在租戶的交易裡入列`);
    }
    requireTenant();
    if (items.length === 0) return;
    for (let start = 0; start < items.length; start += OUTBOX_INSERT_CHUNK) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易連線上依序寫入
      await options.tx.insert(jobOutbox).values(
        items.slice(start, start + OUTBOX_INSERT_CHUNK).map((item) => ({
          name: type.name,
          data: item.data as Record<string, unknown>,
          options: { startAfter: item.startAfter?.toISOString() },
        })),
      );
    }
    this.relayAfterCommit(options.tx);
  }

  /**
   * 把目前租戶 outbox 裡 **已註冊** 的工作搬進佇列，回傳搬了幾筆（docs/architecture/backend/10-jobs.md §4.1）。
   * - 一批 100 筆一個交易，依工作名稱分組，每組一次 pg-boss 的批次 `insert`。
   * - `SKIP LOCKED` 讓提交後的搬移與定期清掃不互搶。
   * - 以 outbox 的 id 當工作 id（pg-boss 的 INSERT 是 `ON CONFLICT DO NOTHING`）：送出後、刪除前當掉而重搬，也只會有一筆工作。
   * - 沒有註冊 handler 的列（工作已下線或改名、滾動部署時只有新版認得）不選、不刪，留給人處理，
   *   也不擋住排在後面的列；定期清掃會記一筆 warn（`sweepOutboxes`）。
   * - `signal` 中止時在兩批之間停下（定期清掃逾時）。
   */
  async relayOutbox(signal?: AbortSignal): Promise<number> {
    const tenant = requireTenant();
    const names = [...this.registrations.keys()];
    let moved = 0;
    for (;;) {
      if (signal?.aborted) return moved;
      // oxlint-disable-next-line no-await-in-loop -- 一批一個短交易，依序處理
      const sent = await withTransaction(this.tenantDb, async (tx) => {
        const rows = await tx
          .select()
          .from(jobOutbox)
          .where(inArray(jobOutbox.name, names))
          .orderBy(asc(jobOutbox.createdAt))
          .limit(OUTBOX_BATCH)
          .for('update', { skipLocked: true });
        const sentIds: string[] = [];
        for (const [name, group] of groupByName(rows)) {
          // 查詢只選已註冊的名稱；這裡仍以實際送出的為準，沒送出的列不刪
          const registration = this.registrations.get(name);
          if (!registration) continue;
          // oxlint-disable-next-line no-await-in-loop -- 同一個交易內依序送出，一批通常只有一兩種工作
          await this.boss.insert(
            name,
            group.map((row) => this.toJobInsert(registration.type, tenant.id, row)),
          );
          sentIds.push(...group.map((row) => row.id));
        }
        if (sentIds.length) await tx.delete(jobOutbox).where(inArray(jobOutbox.id, sentIds));
        return sentIds.length;
      });
      moved += sent;
      // 不滿一批就是搬完了；一筆都沒搬（例：都被另一個搬移鎖住）也停，不會在同一批上空轉
      if (sent < OUTBOX_BATCH) return moved;
    }
  }

  /** 把 `failed` 的工作重新排入。 */
  async retry(name: string, id: string): Promise<boolean> {
    const result = await this.boss.retry(name, id);
    // pg-boss 12 的型別宣告把 CommandResponse 寫成空介面；執行期是 { jobs, requested, affected }
    return ((result as { affected?: number }).affected ?? 0) > 0;
  }

  /** 已註冊的工作名稱（管理頁的佇列清單）。 */
  names(): string[] {
    return [...this.registrations.keys()].toSorted();
  }

  isRegistered(name: string): boolean {
    return this.registrations.has(name);
  }

  /** 已註冊的工作、它的排程（cron，沒有排程是 `null`）與範圍，依名稱排序。 */
  definitions(): Array<{ name: string; cron: string | null; scope: 'tenant' | 'platform' }> {
    return this.names().flatMap((name) => {
      const registration = this.registrations.get(name);
      return registration
        ? [{ name, cron: registration.cron ?? null, scope: registration.type.options.scope }]
        : [];
    });
  }

  private assertRegistered(name: string): void {
    if (!this.registrations.has(name)) {
      throw new Error(`工作 ${name} 沒有註冊 handler；請在擁有它的模組的 onModuleInit 註冊`);
    }
  }

  private send<TData extends object>(
    type: JobType<TData>,
    envelope: JobEnvelope<TData>,
    options: Omit<EnqueueOptions, 'tx'> & { id?: string },
  ): Promise<string | null> {
    return this.boss.send(type.name, envelope, this.jobOptions(type, envelope.tenantId, options));
  }

  private jobOptions(
    type: JobType<object>,
    tenantId: string | null,
    options: Omit<EnqueueOptions, 'tx'> & { id?: string },
  ): BossJobOptions {
    // 節流與 `exclusive` 都以租戶區分：一個租戶的工作不會擋掉另一個租戶的
    const scope = tenantId ?? 'platform';
    const singletonKey = options.throttle
      ? `${scope}:${options.throttle.key}`
      : type.options.exclusive
        ? scope
        : undefined;
    return {
      id: options.id,
      singletonKey,
      singletonSeconds: options.throttle?.seconds,
      startAfter: options.startAfter,
      // 租戶 id 也寫進 pg-boss 的 group_id：同時執行數與管理頁的計數走索引，不解析每一列的 JSON
      // （JobStore.activeAhead）。worker 沒設 groupConcurrency，group 不影響取工作的順序。
      group: tenantId ? { id: tenantId } : undefined,
    };
  }

  /** outbox 的一列 → pg-boss 批次 `insert` 的一筆；outbox 的 id 就是工作 id。 */
  private toJobInsert(type: JobType<object>, tenantId: string, row: JobOutboxRow): JobInsert {
    const envelope: JobEnvelope = { tenantId, payload: row.data };
    return {
      data: envelope,
      ...this.jobOptions(type, tenantId, {
        id: row.id,
        throttle: row.options.throttle,
        startAfter: row.options.startAfter ? new Date(row.options.startAfter) : undefined,
      }),
    };
  }

  /**
   * 交易提交後搬移 outbox，每個交易只登記一次：第一次搬移就把整個租戶的 outbox 搬完，
   * 同一個交易多登記的每一次都只會多開一個什麼都選不到的交易。
   */
  private relayAfterCommit(tx: Transaction): void {
    if (this.relayScheduled.has(tx)) return;
    afterCommit(tx, () => this.relayOutboxSafely());
    this.relayScheduled.add(tx);
  }

  /** 交易提交後的搬移；失敗只記錄，交給定期清掃（`jobs.outboxSweep`）。 */
  private async relayOutboxSafely(): Promise<void> {
    try {
      await this.relayOutbox();
    } catch (error) {
      this.logger.warn({ err: error }, 'outbox 搬移失敗，等定期清掃');
    }
  }

  /**
   * 定期清掃：走遍每個 `active` 租戶補搬，並數一次沒有註冊 handler 的列（有的話每個租戶記一筆 warn）。
   * 工作逾時或程序關閉（`signal`）時停下，不讓上一輪的迴圈與下一輪疊在一起。
   */
  private async sweepOutboxes(
    signal: AbortSignal,
  ): Promise<{ moved: number; failedTenants: string[]; unregistered: number }> {
    let moved = 0;
    let unregistered = 0;
    const failedTenants = await this.tenancy.forEachActive(
      async (tenant) => {
        moved += await this.relayOutbox(signal);
        const leftovers = await this.unregisteredOutbox();
        if (leftovers.length === 0) return;
        unregistered += leftovers.reduce((total, { count }) => total + count, 0);
        this.logger.warn(
          { tenant: tenant.code, jobs: leftovers },
          'outbox 裡有沒有註冊 handler 的工作（已下線或改名）：留在原處，等人處理',
        );
      },
      { signal },
    );
    if (signal.aborted) this.logger.warn({ moved }, 'outbox 清掃逾時或程序關閉，這一輪提前結束');
    return { moved, failedTenants, unregistered };
  }

  /** 目前租戶 outbox 裡沒有註冊 handler 的列，依名稱計數。 */
  private unregisteredOutbox(): Promise<Array<{ name: string; count: number }>> {
    return this.tenantDb
      .select({ name: jobOutbox.name, count: sql<number>`count(*)::int` })
      .from(jobOutbox)
      .where(notInArray(jobOutbox.name, [...this.registrations.keys()]))
      .groupBy(jobOutbox.name);
  }

  /** 排程觸發的租戶工作：每個 `active` 的租戶各入列一筆。 */
  private async fanOut(type: JobType<object>): Promise<{ tenants: number }> {
    const tenants = await this.directory.listActive();
    for (const tenant of tenants) {
      // oxlint-disable-next-line no-await-in-loop -- 租戶數量有限，依序入列
      await this.send(type, { tenantId: tenant.id, payload: {} }, {});
    }
    return { tenants: tenants.length };
  }

  private async execute(
    { type, handler }: Registration,
    envelope: JobEnvelope | null,
    context: JobContext,
  ): Promise<object | void> {
    if (type.options.scope === 'platform') return handler(envelope?.payload ?? {}, context);
    // 排程觸發的沒有租戶：展開成每個租戶一筆
    if (!envelope?.tenantId) return this.fanOut(type);
    const deferred = await this.deferIfTenantBusy(type, envelope.tenantId, context.id);
    if (deferred) return deferred;
    try {
      return await this.tenancy.run(envelope.tenantId, () => handler(envelope.payload, context));
    } catch (error) {
      // 租戶在入列之後被刪除或停用：重試也不會成功，直接結束（停用就是暫停服務，排隊的工作不保留）。
      // migration 落後、DB 連不上是暫時的：照一般失敗處理，由 pg-boss 重試
      if (
        error instanceof AppException &&
        (error.code === 'TENANT_NOT_FOUND' ||
          (error.code === 'TENANT_UNAVAILABLE' && error.details?.reason === 'inactive'))
      ) {
        this.logger.warn({ job: type.name, tenantId: envelope.tenantId }, '租戶無法使用，略過工作');
        return { skipped: error.code };
      }
      throw error;
    }
  }

  /**
   * 租戶的同時執行上限 `job.maxConcurrency`（docs/architecture/05-tenancy.md §13.3 D9）：
   * 這一筆排在上限之後就放回佇列，回傳 handler 的替代結果；否則回 `undefined` 照常執行。
   * 租戶找不到時不判斷，交給 `tenancy.run` 回報。
   */
  private async deferIfTenantBusy(
    type: JobType<object>,
    tenantId: string,
    jobId: string,
  ): Promise<object | undefined> {
    const tenant = await this.directory.findById(tenantId);
    if (!tenant) return undefined;
    const limit = resolveTenantFeatureParam(JOB_MAX_CONCURRENCY_PARAM, tenant.featureParams);
    const ahead = await this.store.activeAhead({
      tenantId,
      name: type.name,
      jobId,
      names: [...this.registrations.keys()],
    });
    if (ahead < limit) return undefined;
    const delay = TENANT_BUSY_DELAY_SECONDS + Math.random() * TENANT_BUSY_JITTER_SECONDS;
    const result = await this.store.requeue(type.name, jobId, delay);
    this.logger.debug({ job: type.name, id: jobId, tenantId, limit, result }, '租戶同時執行數已滿');
    // 放回成功時 pg-boss 的完成是空操作，這個值不會被存下；放不回去時它就是這一筆的 output
    return { skipped: 'TENANT_CONCURRENCY', result };
  }

  private async ensureQueue(type: JobType<object>): Promise<void> {
    const { options } = type;
    const queueOptions = {
      retryLimit: options.retryLimit,
      retryDelay: options.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: options.retryDelayMaxSeconds,
      expireInSeconds: options.expireInSeconds,
      deleteAfterSeconds: options.deleteAfterSeconds,
    } satisfies Omit<Queue, 'name'>;
    const existing = await this.boss.getQueue(type.name);
    if (!existing) {
      await this.boss.createQueue(type.name, {
        ...queueOptions,
        policy: options.exclusive ? 'stately' : 'standard',
      });
      return;
    }
    // policy 建立後不能改；要改就換一個工作名稱
    const { retryDelayMax: _retryDelayMax, ...updatable } = queueOptions;
    await this.boss.updateQueue(type.name, updatable);
  }

  private async startWorker(registration: Registration): Promise<void> {
    const { type } = registration;
    const options = { batchSize: 1, localConcurrency: type.options.concurrency };
    await this.boss.work<JobEnvelope | null>(type.name, options, async ([job]) => {
      if (!job) return;
      try {
        return await this.execute(registration, job.data, {
          id: job.id,
          retryCount: job.retryCount,
          signal: job.signal,
        });
      } catch (error) {
        // 拋出去 pg-boss 才會記錄失敗並依設定重試；這裡只補一筆帶工作資訊的日誌
        this.logger.warn(
          { err: error, job: { name: type.name, id: job.id, retryCount: job.retryCount } },
          '背景工作失敗',
        );
        // pg-boss 把拋出的錯誤連同可列舉的屬性存成工作的 output（持有 job:read 的人看得到）：
        // 資料庫的查詢錯誤換成只帶 SQL 與錯誤碼的版本，參數不跟著存下來（docs/architecture/backend/10-jobs.md §6）
        throw redactDbError(error);
      }
    });
  }

  /** 以程式碼為準：有 cron 的建立或更新排程，沒有的移除（例：環境變數改成空字串）。 */
  private async syncSchedules(): Promise<void> {
    const existing = new Set((await this.boss.getSchedules()).map((schedule) => schedule.name));
    for (const { type, cron } of this.registrations.values()) {
      if (cron) {
        // oxlint-disable-next-line no-await-in-loop -- 排程數量少
        await this.boss.schedule(type.name, cron, null, { tz: 'UTC' });
      } else if (existing.has(type.name)) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.boss.unschedule(type.name);
      }
    }
  }
}

/** 依工作名稱分組，保留每組內的順序（`created_at` 先後）。 */
function groupByName(rows: JobOutboxRow[]): Map<string, JobOutboxRow[]> {
  const groups = new Map<string, JobOutboxRow[]>();
  for (const row of rows) {
    const group = groups.get(row.name);
    if (group) group.push(row);
    else groups.set(row.name, [row]);
  }
  return groups;
}
