import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { containsPattern, PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx, PlatformTransaction } from '@/core/database';
import { notDeleted, tenantDomains, tenants, tenantUsageDaily } from '@/db/platform/schema';
import type { TenantRow, TenantStatus } from '@/db/platform/schema';

export interface TenantWithDomains extends TenantRow {
  /** 依登記順序；第一個是主要網域。 */
  domains: string[];
}

export type NewTenant = Pick<
  TenantRow,
  'code' | 'name' | 'databaseUrlEncrypted' | 'storageBucket' | 'adminEmail' | 'adminName'
>;

export type TenantPatch = Partial<
  Pick<
    TenantRow,
    | 'name'
    | 'status'
    | 'provisionError'
    | 'provisionedAt'
    | 'deletedAt'
    | 'features'
    | 'flags'
    | 'featureParams'
    | 'mfaMethods'
  >
>;

export type TenantListSortField =
  | 'createdAt'
  | 'code'
  | 'usersActive'
  | 'storageUsage'
  | 'recentRequests'
  | 'lastActivityAt';

export interface TenantListFilter {
  offset: number;
  limit: number;
  /** 代碼、名稱或任一網域的部分相符。 */
  q?: string;
  status?: TenantStatus;
  sort: ReadonlyArray<{ sort: TenantListSortField; order: 'asc' | 'desc' }>;
  /** 「近期請求數」從這一天（UTC，含）起算。 */
  recentFrom: string;
}

/** 列表一列的用量摘要（docs/architecture/05-tenancy.md §5.4）；沒有快照時快照欄是 `null`。 */
export interface TenantUsageSummaryRow {
  usersActive: number | null;
  usersTotal: number | null;
  serviceAccounts: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  lastLoginAt: Date | null;
  snapshotAt: Date | null;
  recentRequests: number;
  /** 最後一個有對外 API 請求的日子。 */
  lastExternalDate: string | null;
}

export interface TenantListItem extends TenantWithDomains {
  usage: TenantUsageSummaryRow;
}

/** 平台管理者對租戶登記的讀寫（平台 DB，docs/architecture/05-tenancy.md §10.2 D12、D13）。 */
@Injectable()
export class PlatformTenantRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  transaction<T>(fn: (tx: PlatformTransaction) => Promise<T>): Promise<T> {
    return withTransaction(this.db, fn);
  }

  /** 交易內鎖住租戶列（`FOR UPDATE`）：同一個租戶的網域增刪、狀態變更依序執行。回傳是否存在。 */
  async lock(id: string, tx: PlatformTransaction): Promise<boolean> {
    const [row] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, id), notDeleted(tenants)))
      .for('update');
    return row !== undefined;
  }

  async countDomains(tenantId: string, tx: PlatformDbOrTx = this.db): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId));
    return row?.total ?? 0;
  }

  /**
   * 佈建中斷（程序在佈建途中被重啟、OOM）：`updated_at` 早於 `cutoff` 仍在 `provisioning` 的租戶改成 `failed`，
   * 平台管理者才能重試或刪除。回傳被改掉的租戶。
   */
  async failStaleProvisioning(cutoff: Date, reason: string): Promise<TenantRow[]> {
    return this.db
      .update(tenants)
      .set({ status: 'failed', provisionError: reason, updatedAt: new Date() })
      .where(
        and(eq(tenants.status, 'provisioning'), lt(tenants.updatedAt, cutoff), notDeleted(tenants)),
      )
      .returning();
  }

  async list(filter: TenantListFilter): Promise<{ items: TenantListItem[]; total: number }> {
    const pattern = filter.q ? containsPattern(filter.q) : undefined;
    const where = and(
      notDeleted(tenants),
      filter.status ? eq(tenants.status, filter.status) : undefined,
      pattern
        ? or(
            ilike(tenants.code, pattern),
            ilike(tenants.name, pattern),
            exists(
              this.db
                .select({ one: sql`1` })
                .from(tenantDomains)
                .where(
                  and(eq(tenantDomains.tenantId, tenants.id), ilike(tenantDomains.domain, pattern)),
                ),
            ),
          )
        : undefined,
    );
    // 用量摘要（docs/architecture/05-tenancy.md §14.2 D12）：每個租戶最近一次快照、近期的請求數、最後一個有對外 API 請求的日子。
    // 一個租戶最多保留期限那麼多列，三個 LATERAL 都走主鍵 (tenant_id, date)
    const snapshot = this.db
      .select({
        usersActive: tenantUsageDaily.usersActive,
        usersTotal: tenantUsageDaily.usersTotal,
        serviceAccounts: tenantUsageDaily.serviceAccounts,
        storageUsedBytes: tenantUsageDaily.storageUsedBytes,
        storageQuotaBytes: tenantUsageDaily.storageQuotaBytes,
        lastLoginAt: tenantUsageDaily.lastLoginAt,
        snapshotAt: tenantUsageDaily.snapshotAt,
      })
      .from(tenantUsageDaily)
      .where(and(eq(tenantUsageDaily.tenantId, tenants.id), isNotNull(tenantUsageDaily.snapshotAt)))
      .orderBy(desc(tenantUsageDaily.date))
      .limit(1)
      .as('usage_snapshot');
    const recent = this.db
      .select({
        requests:
          sql<number>`coalesce(sum(${tenantUsageDaily.requestsInternal} + ${tenantUsageDaily.requestsExternal}), 0)::bigint`
            .mapWith(Number)
            .as('recent_requests'),
      })
      .from(tenantUsageDaily)
      .where(
        and(
          eq(tenantUsageDaily.tenantId, tenants.id),
          gte(tenantUsageDaily.date, filter.recentFrom),
        ),
      )
      .as('usage_recent');
    const external = this.db
      .select({
        lastDate: sql<string | null>`max(${tenantUsageDaily.date})`.as('last_external_date'),
      })
      .from(tenantUsageDaily)
      .where(
        and(eq(tenantUsageDaily.tenantId, tenants.id), gt(tenantUsageDaily.requestsExternal, 0)),
      )
      .as('usage_external');

    const sortColumns: Record<TenantListSortField, SQL> = {
      createdAt: sql`${tenants.createdAt}`,
      code: sql`${tenants.code}`,
      usersActive: sql`${snapshot.usersActive}`,
      storageUsage: sql`${snapshot.storageUsedBytes}::float8 / nullif(${snapshot.storageQuotaBytes}, 0)`,
      recentRequests: sql`${recent.requests}`,
      lastActivityAt: sql`greatest(${snapshot.lastLoginAt}, ${external.lastDate}::timestamptz)`,
    };
    // 降冪時沒有值的排最後、升冪時排最前；最後以代碼收尾，讓同值的列在分頁之間順序穩定
    const orderBy = filter.sort.map(({ sort, order }) =>
      order === 'asc'
        ? sql`${sortColumns[sort]} asc nulls first`
        : sql`${sortColumns[sort]} desc nulls last`,
    );

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          tenant: tenants,
          usersActive: snapshot.usersActive,
          usersTotal: snapshot.usersTotal,
          serviceAccounts: snapshot.serviceAccounts,
          storageUsedBytes: snapshot.storageUsedBytes,
          storageQuotaBytes: snapshot.storageQuotaBytes,
          lastLoginAt: snapshot.lastLoginAt,
          snapshotAt: snapshot.snapshotAt,
          recentRequests: recent.requests,
          lastExternalDate: external.lastDate,
        })
        .from(tenants)
        .leftJoinLateral(snapshot, sql`true`)
        .leftJoinLateral(recent, sql`true`)
        .leftJoinLateral(external, sql`true`)
        .where(where)
        .orderBy(...orderBy, asc(tenants.code))
        .limit(filter.limit)
        .offset(filter.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(tenants)
        .where(where),
    ]);
    const withDomains = await this.withDomains(rows.map((row) => row.tenant));
    return {
      items: withDomains.map((tenant, index) => {
        const row = rows[index];
        return Object.assign(tenant, {
          usage: {
            usersActive: row?.usersActive ?? null,
            usersTotal: row?.usersTotal ?? null,
            serviceAccounts: row?.serviceAccounts ?? null,
            storageUsedBytes: row?.storageUsedBytes ?? null,
            storageQuotaBytes: row?.storageQuotaBytes ?? null,
            lastLoginAt: row?.lastLoginAt ?? null,
            snapshotAt: row?.snapshotAt ?? null,
            recentRequests: row?.recentRequests ?? 0,
            lastExternalDate: row?.lastExternalDate ?? null,
          },
        });
      }),
      total: totalRow?.total ?? 0,
    };
  }

  async findById(id: string): Promise<TenantWithDomains | undefined> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), notDeleted(tenants)))
      .limit(1);
    return row ? (await this.withDomains([row]))[0] : undefined;
  }

  async codeTaken(code: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.code, code), notDeleted(tenants)))
      .limit(1);
    return row !== undefined;
  }

  /** 已被使用的 bucket（包含刪除的租戶：bucket 可能還沒清掉）。 */
  async bucketsLike(prefix: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ bucket: tenants.storageBucket })
      .from(tenants)
      .where(sql`${tenants.storageBucket} LIKE ${`${prefix}%`}`);
    return new Set(rows.map((row) => row.bucket));
  }

  async domainsTaken(domains: string[]): Promise<string[]> {
    if (!domains.length) return [];
    const rows = await this.db
      .select({ domain: tenantDomains.domain })
      .from(tenantDomains)
      .where(inArray(tenantDomains.domain, domains));
    return rows.map((row) => row.domain);
  }

  async create(
    tenant: NewTenant,
    domains: string[],
    executor: PlatformDbOrTx = this.db,
  ): Promise<TenantRow> {
    return executor.transaction(async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ ...tenant, status: 'provisioning' })
        .returning();
      if (!row) throw new Error('建立租戶失敗');
      // created_at 的先後決定主要網域；同一個交易裡的 now() 都一樣，所以明確給時間
      const base = Date.now();
      if (domains.length) {
        await tx.insert(tenantDomains).values(
          domains.map((domain, index) => ({
            domain,
            tenantId: row.id,
            createdAt: new Date(base + index),
          })),
        );
      }
      return row;
    });
  }

  /** 條件式更新：給了 `from` 就只在狀態是其中之一時更新；回傳更新後的列，沒更新到回 undefined。 */
  async update(
    id: string,
    patch: TenantPatch,
    from?: readonly TenantStatus[],
    tx: PlatformDbOrTx = this.db,
  ): Promise<TenantRow | undefined> {
    const [row] = await tx
      .update(tenants)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(tenants.id, id),
          notDeleted(tenants),
          from ? inArray(tenants.status, [...from]) : undefined,
        ),
      )
      .returning();
    return row;
  }

  async addDomain(tenantId: string, domain: string, tx: PlatformDbOrTx = this.db): Promise<void> {
    await tx.insert(tenantDomains).values({ domain, tenantId });
  }

  async removeDomain(
    tenantId: string,
    domain: string,
    tx: PlatformDbOrTx = this.db,
  ): Promise<boolean> {
    const removed = await tx
      .delete(tenantDomains)
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.domain, domain)))
      .returning({ domain: tenantDomains.domain });
    return removed.length > 0;
  }

  /** 刪除租戶時釋出它的網域（之後可以登記給別的租戶）。 */
  async removeAllDomains(tenantId: string, tx: PlatformDbOrTx = this.db): Promise<void> {
    await tx.delete(tenantDomains).where(eq(tenantDomains.tenantId, tenantId));
  }

  private async withDomains(rows: TenantRow[]): Promise<TenantWithDomains[]> {
    if (!rows.length) return [];
    const domains = await this.db
      .select({ domain: tenantDomains.domain, tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .where(
        inArray(
          tenantDomains.tenantId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(tenantDomains.createdAt), asc(tenantDomains.domain));
    return rows.map((row) => ({
      ...row,
      domains: domains.filter((d) => d.tenantId === row.id).map((d) => d.domain),
    }));
  }
}
