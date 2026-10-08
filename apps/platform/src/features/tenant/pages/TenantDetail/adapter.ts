import type { PlatformTenant, TenantUsage } from '@/shared/api-sdk';

/** 概覽分頁的基本資料。 */
export interface TenantOverviewVM {
  code: string;
  adminEmail: string | null;
  storageBucket: string;
  createdAt: Date;
  /** 還沒佈建完成時是 `null`。 */
  provisionedAt: Date | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toTenantOverviewVM(dto: PlatformTenant): TenantOverviewVM {
  return {
    code: dto.code,
    adminEmail: dto.adminEmail,
    storageBucket: dto.storageBucket,
    createdAt: new Date(dto.createdAt),
    provisionedAt: dto.provisionedAt ? new Date(dto.provisionedAt) : null,
  };
}

/** 用量分頁的摘要（docs/architecture/05-tenancy.md §5.4）。 */
export interface TenantUsageSummaryVM {
  /** 還沒彙總過：快照的量都是 `null`。 */
  hasSnapshot: boolean;
  snapshotAt: Date | null;
  usersActive: number | null;
  usersTotal: number | null;
  serviceAccounts: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  /** 使用率（%，無條件捨去）；沒有快照時是 `null`。 */
  storagePercent: number | null;
  isStorageWarning: boolean;
  recentRequests: number;
  recentDays: number;
  lastActivityAt: Date | null;
}

/** 趨勢表的一天；新到舊。 */
export interface TenantUsageDayVM {
  date: string;
  usersActive: number | null;
  storageUsedBytes: number | null;
  requestsInternal: number;
  requestsExternal: number;
  jobsExecuted: number;
  /** 這一天的請求數 ÷ 區間內最多的那一天（0–1），畫長條用。 */
  requestsShare: number;
}

export interface TenantUsageVM {
  summary: TenantUsageSummaryVM;
  days: TenantUsageDayVM[];
}

export function toTenantUsageVM(dto: TenantUsage): TenantUsageVM {
  const { summary } = dto;
  const ratio = summary.storageUsageRatio;
  const maxRequests = Math.max(
    0,
    ...dto.daily.map((day) => day.requestsInternal + day.requestsExternal),
  );
  return {
    summary: {
      hasSnapshot: summary.snapshotAt !== null,
      snapshotAt: summary.snapshotAt ? new Date(summary.snapshotAt) : null,
      usersActive: summary.usersActive,
      usersTotal: summary.usersTotal,
      serviceAccounts: summary.serviceAccounts,
      storageUsedBytes: summary.storageUsedBytes,
      storageQuotaBytes: summary.storageQuotaBytes,
      storagePercent: ratio === null ? null : Math.floor(ratio * 100),
      isStorageWarning: ratio !== null && ratio >= dto.warningRatio,
      recentRequests: summary.recentRequests,
      recentDays: dto.recentDays,
      lastActivityAt: summary.lastActivityAt ? new Date(summary.lastActivityAt) : null,
    },
    days: dto.daily.toReversed().map((day) => ({
      date: day.date,
      usersActive: day.usersActive,
      storageUsedBytes: day.storageUsedBytes,
      requestsInternal: day.requestsInternal,
      requestsExternal: day.requestsExternal,
      jobsExecuted: day.jobsExecuted,
      requestsShare: maxRequests ? (day.requestsInternal + day.requestsExternal) / maxRequests : 0,
    })),
  };
}
