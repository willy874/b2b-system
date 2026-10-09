import { Module } from '@nestjs/common';

import { CredentialModule } from '@/modules/credential/credential.module';
import { OidcProviderModule } from '@/modules/oidc-provider/oidc-provider.module';
import { PlatformAdminModule } from '@/modules/platform-admin/platform-admin.module';
import { PlatformNotificationModule } from '@/modules/platform-notification/platform-notification.module';

import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantRepository } from './platform-tenant.repository';
import { PlatformTenantService } from './platform-tenant.service';
import { StorageTotalRollupJob } from './storage-total-rollup.job';
import { StorageTotalService } from './storage-total.service';
import { TenantProvisioner } from './tenant-provisioner';
import { TenantUsageRollupJob } from './tenant-usage-rollup.job';
import { TenantUsageRepository } from './tenant-usage.repository';
import { TenantUsageService } from './tenant-usage.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * 租戶：公開資訊（`/tenant/current`、`/tenants/lookup`）與平台管理者的管理、佈建、用量
 * （docs/architecture/05-tenancy.md §10.2 D11–D13）。
 */
@Module({
  imports: [CredentialModule, OidcProviderModule, PlatformAdminModule, PlatformNotificationModule],
  controllers: [TenantController, PlatformTenantController],
  providers: [
    TenantService,
    PlatformTenantService,
    PlatformTenantRepository,
    TenantProvisioner,
    // 用量的彙總與查詢（docs/architecture/05-tenancy.md §5.4）
    TenantUsageService,
    TenantUsageRepository,
    TenantUsageRollupJob,
    // 儲存的止水線（docs/architecture/backend/25-image.md §12）
    StorageTotalService,
    StorageTotalRollupJob,
  ],
})
export class TenantModule {}
