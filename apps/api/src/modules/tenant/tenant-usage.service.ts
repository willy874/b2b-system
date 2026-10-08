import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { Tenancy, TenantDirectory } from '@/core/tenant';
import { TenantUsageSnapshots, usageDate, usageDateDaysBefore } from '@/core/usage';
import type { TenantUsageSnapshot } from '@/core/usage';
import type { TenantUsageDailyRow } from '@/db/platform/schema';
import {
  PlatformNotificationRoute,
  PlatformNotificationType,
} from '@/modules/platform-notification/platform-notification.constants';
import { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';

import type {
  GetTenantUsageDto,
  TenantUsageDayDto,
  TenantUsageDto,
  TenantUsageSummaryDto,
} from './dto/tenant-usage.dto';
import { PlatformTenantRepository } from './platform-tenant.repository';
import type { TenantUsageSummaryRow } from './platform-tenant.repository';
import { TENANT_USAGE_RECENT_DAYS, TENANT_USAGE_WARNING_RATIO } from './tenant-usage.constants';
import { TenantUsageRepository } from './tenant-usage.repository';

/** 已用量 ÷ 配額；沒有快照或配額是 0 時為 `null`。 */
export function storageUsageRatio(
  used: number | null | undefined,
  quota: number | null | undefined,
): number | null {
  if (used === null || used === undefined || !quota) return null;
  return used / quota;
}

/** 最後活動（§14.2 D7）：最後登入與最後一個有對外 API 請求的日子（當天 00:00 UTC），取較晚者。 */
export function lastActivityAt(
  lastLoginAt: Date | null,
  lastExternalDate: string | null,
): Date | null {
  const external = lastExternalDate ? new Date(`${lastExternalDate}T00:00:00.000Z`) : null;
  if (!lastLoginAt) return external;
  if (!external) return lastLoginAt;
  return lastLoginAt > external ? lastLoginAt : external;
}

/** 列表一列的用量摘要 → DTO。 */
export function toUsageSummary(row: TenantUsageSummaryRow): TenantUsageSummaryDto {
  return {
    usersActive: row.usersActive,
    usersTotal: row.usersTotal,
    serviceAccounts: row.serviceAccounts,
    storageUsedBytes: row.storageUsedBytes,
    storageQuotaBytes: row.storageQuotaBytes,
    storageUsageRatio: storageUsageRatio(row.storageUsedBytes, row.storageQuotaBytes),
    recentRequests: row.recentRequests,
    lastActivityAt: lastActivityAt(row.lastLoginAt, row.lastExternalDate)?.toISOString() ?? null,
    snapshotAt: row.snapshotAt?.toISOString() ?? null,
  };
}

/** 這一次快照讓使用率從門檻以下（或第一次有數字）越過門檻。 */
export function crossedWarning(
  previous: Pick<TenantUsageDailyRow, 'storageUsedBytes' | 'storageQuotaBytes'> | undefined,
  current: Partial<TenantUsageSnapshot>,
): boolean {
  const now = storageUsageRatio(current.storageUsedBytes, current.storageQuotaBytes);
  if (now === null || now < TENANT_USAGE_WARNING_RATIO) return false;
  const before = storageUsageRatio(previous?.storageUsedBytes, previous?.storageQuotaBytes);
  return before === null || before < TENANT_USAGE_WARNING_RATIO;
}

/**
 * 租戶用量（docs/architecture/05-tenancy.md §5.4）：每小時的彙總（快照、配額警示、保留期限）與詳情頁的查詢。
 * 計數（請求、背景工作）由 `core/usage` 的 `UsageMeter` 直接寫入。
 */
@Injectable()
export class TenantUsageService {
  private readonly logger = new Logger(TenantUsageService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly repo: TenantUsageRepository,
    private readonly tenants: PlatformTenantRepository,
    private readonly snapshots: TenantUsageSnapshots,
    private readonly tenancy: Tenancy,
    private readonly directory: TenantDirectory,
    private readonly notifications: PlatformNotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get('TENANT_USAGE_RETENTION_DAYS', { infer: true });
  }

  /**
   * 對每個 `active` 租戶拍一次快照，覆寫當天的列；越過配額門檻的發通知；最後刪掉保留期限以前的日資料。
   * 一個租戶失敗只略過它（`forEachActive` 記錄並回報代碼），其他租戶照常。
   */
  async rollup(signal?: AbortSignal): Promise<{ failed: string[]; purged: number }> {
    const date = usageDate();
    const failed = await this.tenancy.forEachActive(
      async (tenant) => {
        const snapshot = await this.snapshots.collect();
        const previous = await this.repo.latestSnapshot(tenant.id);
        await this.repo.saveSnapshot(tenant.id, date, snapshot, new Date());
        if (crossedWarning(previous, snapshot)) await this.notifyNearQuota(tenant.id, snapshot);
      },
      { signal },
    );
    const purged = await this.repo.purgeBefore(usageDateDaysBefore(date, this.retentionDays));
    if (failed.length) this.logger.warn({ failed }, '部分租戶的用量快照失敗');
    return { failed, purged };
  }

  /** 詳情頁：摘要 ＋ 近 `days` 天（含今天）每天一筆。 */
  async get(tenantId: string, query: GetTenantUsageDto): Promise<TenantUsageDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    const today = usageDate();
    const from = usageDateDaysBefore(today, query.days - 1);
    const recentFrom = usageDateDaysBefore(today, TENANT_USAGE_RECENT_DAYS - 1);
    const [rows, latest, lastExternalDate] = await Promise.all([
      this.repo.daily(tenantId, from),
      this.repo.latestSnapshot(tenantId),
      this.repo.lastExternalDate(tenantId),
    ]);
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const daily: TenantUsageDayDto[] = [];
    for (let offset = query.days - 1; offset >= 0; offset -= 1) {
      const date = usageDateDaysBefore(today, offset);
      daily.push(toUsageDay(date, byDate.get(date)));
    }
    const recentRequests = rows
      .filter((row) => row.date >= recentFrom)
      .reduce((sum, row) => sum + row.requestsInternal + row.requestsExternal, 0);
    return {
      summary: toUsageSummary({
        usersActive: latest?.usersActive ?? null,
        usersTotal: latest?.usersTotal ?? null,
        serviceAccounts: latest?.serviceAccounts ?? null,
        storageUsedBytes: latest?.storageUsedBytes ?? null,
        storageQuotaBytes: latest?.storageQuotaBytes ?? null,
        lastLoginAt: latest?.lastLoginAt ?? null,
        snapshotAt: latest?.snapshotAt ?? null,
        recentRequests,
        lastExternalDate,
      }),
      warningRatio: TENANT_USAGE_WARNING_RATIO,
      recentDays: TENANT_USAGE_RECENT_DAYS,
      daily,
    };
  }

  private async notifyNearQuota(
    tenantId: string,
    snapshot: Partial<TenantUsageSnapshot>,
  ): Promise<void> {
    const tenant = await this.directory.findById(tenantId);
    if (!tenant) return;
    const ratio = storageUsageRatio(snapshot.storageUsedBytes, snapshot.storageQuotaBytes) ?? 0;
    await this.notifications.notifyHolders('tenant:update', {
      type: PlatformNotificationType.TENANT_STORAGE_NEAR_QUOTA,
      params: { code: tenant.code, name: tenant.name, percent: Math.floor(ratio * 100) },
      link: { route: PlatformNotificationRoute.TENANT_DETAIL, params: { id: tenant.id } },
    });
  }
}

function toUsageDay(date: string, row: TenantUsageDailyRow | undefined): TenantUsageDayDto {
  return {
    date,
    usersActive: row?.usersActive ?? null,
    usersTotal: row?.usersTotal ?? null,
    serviceAccounts: row?.serviceAccounts ?? null,
    storageUsedBytes: row?.storageUsedBytes ?? null,
    storageQuotaBytes: row?.storageQuotaBytes ?? null,
    requestsInternal: row?.requestsInternal ?? 0,
    requestsExternal: row?.requestsExternal ?? 0,
    jobsExecuted: row?.jobsExecuted ?? 0,
  };
}
