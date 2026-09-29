import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { createDatabase } from '../database';
import type { Database } from '../database';
import { AppException } from '../errors';
import { runInTenantContext } from './tenant-context';
import type { TenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import type { TenantRecord } from './tenant-directory.service';

interface Pool {
  url: string;
  close: () => Promise<void>;
  db: Database;
}

/**
 * 進入租戶脈絡的唯一入口（docs/adr/0020-physical-tenant-isolation.md D3）：HTTP 由 `TenantMiddleware`、
 * WebSocket 由 gateway、背景工作由 `JobQueue` 呼叫。每個租戶第一次用到時建立自己的小連線池；
 * 閒置的連線由 postgres.js 的 `idle_timeout` 關閉，連線池物件本身很便宜，不另外回收。
 */
@Injectable()
export class Tenancy implements OnApplicationShutdown {
  private readonly logger = new Logger(Tenancy.name);
  private readonly pools = new Map<string, Pool>();
  private readonly poolMax: number;

  constructor(
    private readonly directory: TenantDirectory,
    config: ConfigService<Env, true>,
  ) {
    this.poolMax = config.get('TENANT_POOL_MAX', { infer: true });
  }

  /** 已解析的租戶 → 脈絡；只有 `active` 的租戶可以進入。 */
  contextOf(tenant: TenantRecord): TenantContext {
    if (tenant.status !== 'active') throw new AppException('TENANT_UNAVAILABLE');
    return { id: tenant.id, code: tenant.code, db: this.poolOf(tenant).db };
  }

  /** 以 id 進入租戶（背景工作、腳本）。租戶不存在或不是 `active` 時拋錯。 */
  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const tenant = await this.directory.findById(tenantId);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    return runInTenantContext(this.contextOf(tenant), fn);
  }

  /** 依序在每個 `active` 的租戶裡執行；單一租戶失敗不影響其他租戶，回傳失敗的租戶代碼。 */
  async forEachActive(fn: (tenant: TenantContext) => Promise<void>): Promise<string[]> {
    const failed: string[] = [];
    for (const tenant of await this.directory.listActive()) {
      const context = this.contextOf(tenant);
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序執行，不一次打開所有租戶的連線
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

  private poolOf(tenant: TenantRecord): Pool {
    const existing = this.pools.get(tenant.id);
    if (existing?.url === tenant.databaseUrl) return existing;
    // 連線字串換了（搬到別的叢集、換 DB 角色）：之後的請求用新的連線池，舊的讓執行中的查詢做完再關
    if (existing) void existing.close();
    const { client, db } = createDatabase({
      url: tenant.databaseUrl,
      max: this.poolMax,
      idleTimeout: 60,
      logQueries: false,
    });
    const pool: Pool = { url: tenant.databaseUrl, db, close: () => client.end({ timeout: 5 }) };
    this.pools.set(tenant.id, pool);
    return pool;
  }
}
