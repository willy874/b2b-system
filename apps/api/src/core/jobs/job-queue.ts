import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, inArray } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { Queue } from 'pg-boss';

import { jobOutbox } from '@/db/schema';

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

interface Registration {
  type: JobType<object>;
  handler: JobHandler<object>;
  cron: string | undefined;
}

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
    this.register(OUTBOX_SWEEP_JOB, () => this.sweepOutboxes(), {
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
    afterCommit(options.tx, () => this.relayOutboxSafely());
    return row?.id ?? null;
  }

  /**
   * 把目前租戶 outbox 裡的工作搬進佇列，回傳搬了幾筆。`SKIP LOCKED` 讓提交後的搬移與定期清掃不互搶；
   * 以 outbox 的 id 當工作 id，萬一搬了兩次（送出後、刪除前當掉）也只會有一筆工作。
   */
  async relayOutbox(): Promise<number> {
    const tenant = requireTenant();
    let moved = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 一批一個短交易，依序處理
      const batch = await withTransaction(this.tenantDb, async (tx) => {
        const rows = await tx
          .select()
          .from(jobOutbox)
          .orderBy(asc(jobOutbox.createdAt))
          .limit(OUTBOX_BATCH)
          .for('update', { skipLocked: true });
        const sent: string[] = [];
        for (const row of rows) {
          const registration = this.registrations.get(row.name);
          if (!registration) {
            // 工作已下線：留在 outbox 讓人處理，不能默默丟掉
            this.logger.error({ id: row.id, name: row.name }, 'outbox 裡的工作沒有註冊 handler');
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop -- 同一個交易內依序送出
          await this.send(
            registration.type,
            { tenantId: tenant.id, payload: row.data },
            {
              id: row.id,
              throttle: row.options.throttle,
              startAfter: row.options.startAfter ? new Date(row.options.startAfter) : undefined,
            },
          );
          sent.push(row.id);
        }
        if (sent.length) await tx.delete(jobOutbox).where(inArray(jobOutbox.id, sent));
        return { size: rows.length, sent: sent.length };
      });
      moved += batch.sent;
      if (batch.size < OUTBOX_BATCH) return moved;
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
    // 節流與 `exclusive` 都以租戶區分：一個租戶的工作不會擋掉另一個租戶的
    const scope = envelope.tenantId ?? 'platform';
    const singletonKey = options.throttle
      ? `${scope}:${options.throttle.key}`
      : type.options.exclusive
        ? scope
        : undefined;
    return this.boss.send(type.name, envelope, {
      id: options.id,
      singletonKey,
      singletonSeconds: options.throttle?.seconds,
      startAfter: options.startAfter,
      // 租戶 id 也寫進 pg-boss 的 group_id：同時執行數與管理頁的計數走索引，不解析每一列的 JSON
      // （JobStore.activeAhead）。worker 沒設 groupConcurrency，group 不影響取工作的順序。
      group: envelope.tenantId ? { id: envelope.tenantId } : undefined,
    });
  }

  /** 交易提交後的搬移；失敗只記錄，交給定期清掃（`jobs.outboxSweep`）。 */
  private async relayOutboxSafely(): Promise<void> {
    try {
      await this.relayOutbox();
    } catch (error) {
      this.logger.warn({ err: error }, 'outbox 搬移失敗，等定期清掃');
    }
  }

  private async sweepOutboxes(): Promise<{ moved: number; failedTenants: string[] }> {
    let moved = 0;
    const failedTenants = await this.tenancy.forEachActive(async () => {
      moved += await this.relayOutbox();
    });
    return { moved, failedTenants };
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
