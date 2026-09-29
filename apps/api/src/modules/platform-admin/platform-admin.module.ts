import { Global, Module } from '@nestjs/common';

import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditService } from './platform-audit.service';

/**
 * 平台管理者與平台稽核（docs/adr/0020-physical-tenant-isolation.md D5、D19）。葉節點：只依賴平台 DB。
 * global：`PermissionsGuard` 判斷平台端點的權限時要用，而 gateway 以 `@UseGuards` 在自己的模組裡建立 guard。
 */
@Global()
@Module({
  providers: [PlatformAdminRepository, PlatformAdminService, PlatformAuditService],
  exports: [PlatformAdminService, PlatformAuditService],
})
export class PlatformAdminModule {}
