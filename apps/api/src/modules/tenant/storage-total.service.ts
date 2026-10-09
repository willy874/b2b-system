import { Injectable, Logger } from '@nestjs/common';

import { Tenancy } from '@/core/tenant';
import {
  STORAGE_TOTAL_STALE_AFTER_MS,
  StorageCapacity,
  StorageTotalRepository,
  TenantStorageUsage,
} from '@/core/usage';
import {
  PlatformNotificationRoute,
  PlatformNotificationType,
} from '@/modules/platform-notification/platform-notification.constants';
import { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';

import type { StorageTotalDto } from './dto/storage-total.dto';
import { STORAGE_TOTAL_NOTIFY_RATIOS, STORAGE_TOTAL_WARNING_RATIO } from './tenant-usage.constants';

/** 這次彙總讓使用率越過的最高通知門檻；沒有越過任何一個時 `undefined`。 */
export function crossedStorageTotalRatio(before: number, after: number): number | undefined {
  return STORAGE_TOTAL_NOTIFY_RATIOS.find((ratio) => before < ratio && after >= ratio);
}

/**
 * 儲存的止水線的彙總（docs/architecture/backend/25-image.md §12 D8）：平台的背景工作逐一進入 active 的租戶，
 * 讀已用量（`TenantStorageUsage`）寫進平台 DB；越過 80%、100% 時通知平台管理者。上傳時的判斷在 `core/usage` 的 `StorageCapacity`。
 */
@Injectable()
export class StorageTotalService {
  private readonly logger = new Logger(StorageTotalService.name);

  constructor(
    private readonly tenancy: Tenancy,
    private readonly storageUsage: TenantStorageUsage,
    private readonly repo: StorageTotalRepository,
    private readonly capacity: StorageCapacity,
    private readonly notifications: PlatformNotificationService,
  ) {}

  /** 量不到的租戶（失敗、停用）保留上一次的值：它們的物件仍佔著空間。 */
  async rollup(signal?: AbortSignal): Promise<{ failed: string[]; usedBytes: number }> {
    const before = await this.repo.total();
    const failed = await this.tenancy.forEachActive(
      async (tenant) => {
        const used = await this.storageUsage.used();
        await this.repo.save(tenant.id, used, new Date());
      },
      { signal },
    );
    const after = await this.repo.total();
    this.capacity.invalidate();
    if (failed.length) this.logger.warn({ failed }, '部分租戶的已用量量測失敗，沿用上一次的值');

    const limit = this.capacity.limitBytes;
    if (limit > 0) {
      const crossed = crossedStorageTotalRatio(before.usedBytes / limit, after.usedBytes / limit);
      if (crossed !== undefined) {
        this.logger.warn(
          { usedBytes: after.usedBytes, limitBytes: limit },
          '儲存的已用量越過止水線的門檻',
        );
        await this.notifications.notifyHolders('tenant:update', {
          type: PlatformNotificationType.STORAGE_TOTAL_NEAR_LIMIT,
          params: { percent: Math.floor((after.usedBytes / limit) * 100) },
          link: { route: PlatformNotificationRoute.TENANT_LIST, params: {} },
        });
      }
    }
    return { failed, usedBytes: after.usedBytes };
  }

  async summary(): Promise<StorageTotalDto> {
    const total = await this.repo.total();
    const limit = this.capacity.limitBytes;
    const measuredAt = total.measuredAt;
    return {
      usedBytes: total.usedBytes,
      limitBytes: limit > 0 ? limit : null,
      usageRatio: limit > 0 ? total.usedBytes / limit : null,
      warningRatio: STORAGE_TOTAL_WARNING_RATIO,
      measuredAt: measuredAt?.toISOString() ?? null,
      isStale:
        measuredAt === null || Date.now() - measuredAt.getTime() > STORAGE_TOTAL_STALE_AFTER_MS,
    };
  }
}
