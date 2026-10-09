import type { PlatformTenantListItem, StorageTotal } from '@/shared/api-sdk';

export interface TenantRowVM {
  id: string;
  code: string;
  name: string;
  status: PlatformTenantListItem['status'];
  /** 第一個網域是主要網域；理論上至少有一個，沒有時是 `undefined`。 */
  primaryDomain: string | undefined;
  createdAt: Date;
  /** 用量摘要（docs/architecture/05-tenancy.md §5.4）；還沒彙總過的租戶，快照的量是 `null`。 */
  usersActive: number | null;
  usersTotal: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  storageUsageRatio: number | null;
  /** 使用率達到警示門檻。 */
  isStorageWarning: boolean;
  recentRequests: number;
  lastActivityAt: Date | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toTenantRowVM(dto: PlatformTenantListItem, warningRatio: number): TenantRowVM {
  const { usage } = dto;
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    status: dto.status,
    primaryDomain: dto.domains[0],
    createdAt: new Date(dto.createdAt),
    usersActive: usage.usersActive,
    usersTotal: usage.usersTotal,
    storageUsedBytes: usage.storageUsedBytes,
    storageQuotaBytes: usage.storageQuotaBytes,
    storageUsageRatio: usage.storageUsageRatio,
    isStorageWarning: usage.storageUsageRatio !== null && usage.storageUsageRatio >= warningRatio,
    recentRequests: usage.recentRequests,
    lastActivityAt: usage.lastActivityAt ? new Date(usage.lastActivityAt) : null,
  };
}

export interface StorageTotalVM {
  usedBytes: number;
  limitBytes: number;
  /** 無條件捨去（與通知同一個算法）。 */
  percent: number;
  /** 越過警示門檻（80%）。 */
  isWarning: boolean;
  /** 已達止水線：所有租戶都無法上傳。 */
  isReached: boolean;
  /** 彙總太久沒更新：止水線暫時不擋。 */
  isStale: boolean;
  measuredAt: Date | null;
}

/** 儲存的止水線（docs/architecture/backend/25-image.md §12）；部署沒有啟用時回 `null`（畫面不顯示）。 */
export function toStorageTotalVM(dto: StorageTotal): StorageTotalVM | null {
  if (dto.limitBytes === null || dto.usageRatio === null) return null;
  return {
    usedBytes: dto.usedBytes,
    limitBytes: dto.limitBytes,
    percent: Math.floor(dto.usageRatio * 100),
    isWarning: dto.usageRatio >= dto.warningRatio,
    isReached: dto.usageRatio >= 1,
    isStale: dto.isStale,
    measuredAt: dto.measuredAt ? new Date(dto.measuredAt) : null,
  };
}
