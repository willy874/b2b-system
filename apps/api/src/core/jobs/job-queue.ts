import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { Db, Queue } from 'pg-boss';

import type { Env } from '../config';
import type { Transaction } from '../database';
import type { JobType } from './job-type';

/** pg-boss 的表放在自己的 schema，與業務表分開（docs/architecture/backend/10-jobs.md §2）。 */
export const JOB_SCHEMA = 'pgboss';

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
  /** 業務交易：入列與資料一起提交或一起回滾（docs/adr/0016-background-jobs.md D2）。 */
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
 * 換掉 pg-boss 不影響模組（docs/adr/0016-background-jobs.md）。
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

  constructor(config: ConfigService<Env, true>) {
    this.workerEnabled = config.get('JOBS_WORKER_ENABLED', { infer: true });
    this.boss = new PgBoss({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      schema: JOB_SCHEMA,
      application_name: 'game-editor-jobs',
      // pg-boss 自己的連線池（它用 `pg`）；業務交易內的入列走 fromDrizzle，不佔用這裡的連線
      max: 4,
      // 排程與維護（逾時、清除過期工作）只在執行工作的程序跑
      schedule: this.workerEnabled,
      supervise: this.workerEnabled,
    });
    // 沒有監聽 error 的 EventEmitter 會讓程序直接崩潰；pg-boss 的背景迴圈錯誤會自己重試
    this.boss.on('error', (error) => this.logger.error({ err: error }, 'pg-boss 背景作業失敗'));
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

  /** 入列；回傳工作 id。被 `throttle` 擋下時回傳 `null`。 */
  async enqueue<TData extends object>(
    type: JobType<TData>,
    data: TData,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    this.assertRegistered(type.name);
    return this.boss.send(type.name, data, {
      db: this.dbOf(options.tx),
      singletonKey: options.throttle?.key,
      singletonSeconds: options.throttle?.seconds,
      startAfter: options.startAfter,
    });
  }

  /** 把 `failed` 的工作重新排入；`tx` 讓它與稽核一起提交。 */
  async retry(name: string, id: string, tx?: Transaction): Promise<boolean> {
    const result = await this.boss.retry(name, id, { db: this.dbOf(tx) });
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

  /** 已註冊的工作與它的排程（cron，沒有排程是 `null`），依名稱排序。 */
  definitions(): Array<{ name: string; cron: string | null }> {
    return this.names().map((name) => ({
      name,
      cron: this.registrations.get(name)?.cron ?? null,
    }));
  }

  private assertRegistered(name: string): void {
    if (!this.registrations.has(name)) {
      throw new Error(`工作 ${name} 沒有註冊 handler；請在擁有它的模組的 onModuleInit 註冊`);
    }
  }

  private dbOf(tx: Transaction | undefined): Db | undefined {
    return tx ? fromDrizzle(tx, sql) : undefined;
  }

  private async ensureQueue(type: JobType<object>): Promise<void> {
    const { options } = type;
    const queueOptions = {
      retryLimit: options.retryLimit,
      retryDelay: options.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: options.retryDelayMaxSeconds,
      expireInSeconds: options.expireInSeconds,
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

  private async startWorker({ type, handler }: Registration): Promise<void> {
    await this.boss.work<object>(type.name, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      try {
        return await handler(job.data, {
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
        throw error;
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
