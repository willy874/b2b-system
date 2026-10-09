import { Global, Module } from '@nestjs/common';

import { StorageCapacity } from './storage-capacity';
import { StorageTotalRepository } from './storage-total.repository';
import { TenantStorageUsage } from './tenant-storage-usage';
import { TenantUsageSnapshots } from './tenant-usage-snapshots';
import { UsageCounterRepository } from './usage-counter.repository';
import { UsageMeter } from './usage-meter';
import { UsageRequestMiddleware } from './usage-request.middleware';

/**
 * 租戶用量的機制（docs/architecture/05-tenancy.md §5.4）：計數（`UsageMeter`）、請求的計數 middleware、
 * 快照來源的登記表；儲存的止水線（`StorageCapacity`、`TenantStorageUsage`，docs/architecture/backend/25-image.md §12）。
 * 彙總、查詢與通知在 `modules/tenant`。
 */
@Global()
@Module({
  providers: [
    UsageCounterRepository,
    UsageMeter,
    UsageRequestMiddleware,
    TenantUsageSnapshots,
    TenantStorageUsage,
    StorageTotalRepository,
    StorageCapacity,
  ],
  exports: [
    UsageMeter,
    UsageRequestMiddleware,
    TenantUsageSnapshots,
    TenantStorageUsage,
    StorageTotalRepository,
    StorageCapacity,
  ],
})
export class UsageModule {}
