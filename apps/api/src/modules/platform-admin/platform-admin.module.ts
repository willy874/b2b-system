import { Module } from '@nestjs/common';

import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditService } from './platform-audit.service';

/** 平台管理者與平台稽核（docs/adr/0020-physical-tenant-isolation.md D5、D19）。葉節點：只依賴平台 DB。 */
@Module({
  providers: [PlatformAdminRepository, PlatformAdminService, PlatformAuditService],
  exports: [PlatformAdminService, PlatformAuditService],
})
export class PlatformAdminModule {}
