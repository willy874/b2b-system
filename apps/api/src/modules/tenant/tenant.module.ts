import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { PlatformAdminModule } from '@/modules/platform-admin/platform-admin.module';

import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantRepository } from './platform-tenant.repository';
import { PlatformTenantService } from './platform-tenant.service';
import { TenantProvisioner } from './tenant-provisioner';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * 租戶：公開資訊（`/tenant/current`、`/tenants/lookup`）與平台管理者的管理、佈建
 * （docs/adr/0020-physical-tenant-isolation.md D11–D13）。
 */
@Module({
  imports: [AuthModule, PlatformAdminModule],
  controllers: [TenantController, PlatformTenantController],
  providers: [TenantService, PlatformTenantService, PlatformTenantRepository, TenantProvisioner],
})
export class TenantModule {}
