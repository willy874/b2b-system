import { Global, Module } from '@nestjs/common';

import { PlatformNotificationModule } from '@/modules/platform-notification/platform-notification.module';

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
 * 平台管理者、他們的帳號流程、refresh token 與平台稽核（docs/architecture/05-tenancy.md §10.2 D5、D19）。
 * 平台 DB 的表都歸這個模組（平台的站內通知除外，歸 `platform-notification`）。只依賴平台 DB、core、`credential/` 的純函式
 * 與 `platform-notification`（換角色時通知本人），不依賴其他業務模組的 DI。
 * global：`PermissionsGuard` 判斷平台端點的權限時要用；job、feature-flag 的平台 service 也沒有 import 這個模組就注入它的 service。
 */
@Global()
@Module({
  imports: [PlatformNotificationModule],
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
