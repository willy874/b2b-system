import { Module } from '@nestjs/common';

import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/** 租戶的公開資訊；建立、停用與佈建在交付順序第 4 步加入（docs/features/tenant-isolation.md）。 */
@Module({
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
