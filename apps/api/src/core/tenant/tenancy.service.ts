import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { connectionLimitsOf, createDatabase } from '../database';
import type { ConnectionLimits, Database } from '../database';
import { AppException } from '../errors';
import { runInTenantContext } from './tenant-context';
import type { TenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import type { TenantRecord } from './tenant-directory.service';
import { appliedTenantMigration, EXPECTED_TENANT_MIGRATION } from './tenant-schema';

interface Pool {
  url: string;
  close: () => Promise<void>;
  db: Database;
}

type SchemaState = 'current' | 'behind' | 'error';

interface SchemaCheck {
  /** 檢查的是哪個連線字串；換了 DB 就要重新檢查。 */
  url: string;
  checkedAt: number;
  state: Promise<SchemaState>;
}

export type TenantUnavailableReason = 'inactive' | 'maintenance';

function tenantUnavailable(reason: TenantUnavailableReason): AppException {
  return new AppException('TENANT_UNAVAILABLE', { reason });
}

/** 落後的租戶多久重新檢查一次：補跑 `db:migrate` 之後不必重啟程序就會恢復。 */
export const SCHEMA_RECHECK_MS = 30_000;

/**
 * 進入租戶脈絡的唯一入口（docs/architecture/05-tenancy.md §10.2 D3）：HTTP 由 `TenantMiddleware`、
 * WebSocket 由 gateway、背景工作由 `JobQueue` 呼叫。每個租戶第一次用到時建立自己的小連線池；
 * 閒置的連線由 postgres.js 的 `idle_timeout`（`TENANT_POOL_IDLE_TIMEOUT`）關閉，連線池物件本身很便宜，不另外回收。
 *
 * 只有 migration 版本沒有落後的租戶可以進入（D14）：啟動時檢查每個 `active` 租戶，之後新登記的租戶在第一次進入時檢查。
 * 落後的租戶回 `TENANT_UNAVAILABLE`（503），不阻止整個程序啟動，也不影響其他租戶。
 * DB 比程式新（滾動部署時舊的執行個體、或程式回滾）照常服務：migration 必須對上一版程式相容。
 */
@Injectable()
export class Tenancy implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Tenancy.name);
  private readonly pools = new Map<string, Pool>();
  private readonly schemaChecks = new Map<string, SchemaCheck>();
  private readonly poolMax: number;
  private readonly poolIdleTimeout: number;
  private readonly limits: ConnectionLimits;

  constructor(
    private readonly directory: TenantDirectory,
    config: ConfigService<Env, true>,
  ) {
    this.poolMax = config.get('TENANT_POOL_MAX', { infer: true });
    this.poolIdleTimeout = config.get('TENANT_POOL_IDLE_TIMEOUT', { infer: true });
    this.limits = connectionLimitsOf({
      DB_CONNECT_TIMEOUT: config.get('DB_CONNECT_TIMEOUT', { infer: true }),
      DB_STATEMENT_TIMEOUT_MS: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: config.get('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', {
        infer: true,
      }),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const unavailable: string[] = [];
    for (const tenant of await this.directory.listActive()) {
      // oxlint-disable-next-line no-await-in-loop -- 依序檢查，不在啟動時一次打開所有租戶的連線
      if ((await this.schemaStateOf(tenant)) !== 'current') unavailable.push(tenant.code);
    }
    if (unavailable.length) {
      this.logger.error(
        { tenants: unavailable },
        '這些租戶的 migration 落後或無法檢查，暫停服務（補跑 pnpm db:migrate 後自動恢復）',
      );
    }
  }

  /**
   * 已解析的租戶 → 脈絡。不能進入時拋 `TENANT_UNAVAILABLE`，`details.reason` 分兩種：
   * `inactive`（停用、佈建中、佈建失敗：平台管理者的決定，重試沒有用）與
   * `maintenance`（migration 落後、DB 連不上：暫時的，稍後重試會好）。背景工作依此決定略過或重試。
   */
  async enter(tenant: TenantRecord): Promise<TenantContext> {
    if (tenant.status !== 'active') throw tenantUnavailable('inactive');
    if ((await this.schemaStateOf(tenant)) !== 'current') throw tenantUnavailable('maintenance');
    return this.contextOf(tenant);
  }

  /**
   * 不看租戶狀態進入（仍檢查 migration 版本）：只給平台管理者對租戶本身的維運動作用，例如停用 **之後**
   * 撤銷 session——那時租戶已經不能用一般的 `run` 進入。
   */
  async runForMaintenance<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const tenant = await this.directory.findById(tenantId);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    if ((await this.schemaStateOf(tenant)) !== 'current') throw tenantUnavailable('maintenance');
    return runInTenantContext(this.contextOf(tenant), fn);
  }

  /** 關掉租戶的連線池（停用、刪除之後）；下次進入時重建。 */
  async evict(tenantId: string): Promise<void> {
    const pool = this.pools.get(tenantId);
    this.pools.delete(tenantId);
    this.schemaChecks.delete(tenantId);
    await pool?.close();
  }

  /** 以 id 進入租戶（背景工作、腳本）。租戶不存在或不能進入時拋錯。 */
  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const tenant = await this.directory.findById(tenantId);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    return runInTenantContext(await this.enter(tenant), fn);
  }

  /**
   * 依序在每個 `active` 的租戶裡執行；單一租戶失敗不影響其他租戶，回傳失敗的租戶代碼。
   * `signal` 中止時不再進入下一個租戶（例：背景工作逾時），已在執行的那一個由 `fn` 自己決定何時停。
   */
  async forEachActive(
    fn: (tenant: TenantContext) => Promise<void>,
    options: { signal?: AbortSignal } = {},
  ): Promise<string[]> {
    const failed: string[] = [];
    for (const tenant of await this.directory.listActive()) {
      if (options.signal?.aborted) break;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序執行，不一次打開所有租戶的連線
        const context = await this.enter(tenant);
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await runInTenantContext(context, () => fn(context));
      } catch (error) {
        this.logger.error({ err: error, tenant: tenant.code }, '租戶的作業失敗');
        failed.push(tenant.code);
      }
    }
    return failed;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
    this.pools.clear();
  }

  private contextOf(tenant: TenantRecord): TenantContext {
    return {
      id: tenant.id,
      code: tenant.code,
      db: this.poolOf(tenant).db,
      storageBucket: tenant.storageBucket,
      features: tenant.features,
      flags: tenant.flags,
      featureParams: tenant.featureParams,
    };
  }

  /**
   * 目前的 migration 狀態。對上版本的結果一直沿用（同一個連線字串）；落後的結果 `SCHEMA_RECHECK_MS` 後重新檢查；
   * 檢查失敗（DB 連不上）不沿用，下一次進入就重試。併發的請求共用同一次檢查。
   */
  private async schemaStateOf(tenant: TenantRecord): Promise<SchemaState> {
    const cached = this.schemaChecks.get(tenant.id);
    if (cached?.url === tenant.databaseUrl) {
      const state = await cached.state;
      if (state === 'current') return state;
      if (state === 'behind' && Date.now() - cached.checkedAt < SCHEMA_RECHECK_MS) return state;
      // 等待期間別的請求可能已經重新檢查過
      const latest = this.schemaChecks.get(tenant.id);
      if (latest !== cached && latest?.url === tenant.databaseUrl) return latest.state;
    }
    const check: SchemaCheck = {
      url: tenant.databaseUrl,
      checkedAt: Date.now(),
      state: this.checkSchema(tenant),
    };
    this.schemaChecks.set(tenant.id, check);
    return check.state;
  }

  private async checkSchema(tenant: TenantRecord): Promise<SchemaState> {
    try {
      const applied = await appliedTenantMigration(this.poolOf(tenant).db);
      if (applied !== undefined && applied >= EXPECTED_TENANT_MIGRATION) {
        if (applied > EXPECTED_TENANT_MIGRATION) {
          this.logger.warn(
            { tenant: tenant.code, applied, expected: EXPECTED_TENANT_MIGRATION },
            '租戶的 migration 比程式新（滾動部署中或程式回滾），照常服務',
          );
        }
        return 'current';
      }
      this.logger.error(
        { tenant: tenant.code, applied: applied ?? null, expected: EXPECTED_TENANT_MIGRATION },
        '租戶的 migration 落後，暫停服務（補跑 pnpm db:migrate 後自動恢復）',
      );
      return 'behind';
    } catch (error) {
      this.logger.error({ err: error, tenant: tenant.code }, '無法檢查租戶的 migration 版本');
      return 'error';
    }
  }

  private poolOf(tenant: TenantRecord): Pool {
    const existing = this.pools.get(tenant.id);
    if (existing?.url === tenant.databaseUrl) return existing;
    // 連線字串換了（搬到別的叢集、換 DB 角色）：之後的請求用新的連線池，舊的讓執行中的查詢做完再關
    if (existing) void existing.close();
    const { client, db } = createDatabase({
      url: tenant.databaseUrl,
      max: this.poolMax,
      idleTimeout: this.poolIdleTimeout,
      logQueries: false,
      limits: this.limits,
    });
    const pool: Pool = { url: tenant.databaseUrl, db, close: () => client.end({ timeout: 5 }) };
    this.pools.set(tenant.id, pool);
    return pool;
  }
}
