import { Global, Module } from '@nestjs/common';

import { PlatformAccountMailJobs } from './platform-account-mail.jobs';
import { PlatformAccountService } from './platform-account.service';
import { PlatformAdminManagementService } from './platform-admin-management.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogRepository } from './platform-audit-log.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthTokenRepository } from './platform-auth-token.repository';
import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';
import { PlatformRefreshTokenService } from './platform-refresh-token.service';
import { PlatformTokenCleanupJobs } from './platform-token-cleanup.jobs';

/**
 * 平台管理者、他們的帳號流程與平台稽核（docs/adr/0020-physical-tenant-isolation.md D5、D19）。葉節點：只依賴平台 DB 與 core。
 * global：`PermissionsGuard` 判斷平台端點的權限時要用，而 gateway 以 `@UseGuards` 在自己的模組裡建立 guard。
 */
@Global()
@Module({
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminRepository,
    PlatformAuthTokenRepository,
    PlatformAuditLogRepository,
    PlatformAdminService,
    PlatformAdminManagementService,
    PlatformAccountService,
    PlatformAuditService,
    PlatformAccountMailJobs,
    PlatformRefreshTokenRepository,
    PlatformRefreshTokenService,
    PlatformTokenCleanupJobs,
  ],
  exports: [
    PlatformAdminService,
    PlatformAccountService,
    PlatformAuditService,
    PlatformRefreshTokenService,
  ],
})
export class PlatformAdminModule {}
