import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { AuthMailJobs } from './auth-mail.jobs';
import { AuthTokenCleanupJobs } from './auth-token-cleanup.jobs';
import { AuthTokenService } from './auth-token.service';
import { AUTH_SETTINGS } from './auth.settings';
import { LoginSourceService } from './login-source.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RefreshTokenService } from './refresh-token.service';

/**
 * 憑證的基礎設施：租戶的 refresh token 與啟用／重設密碼 token、帳號連結信、密碼雜湊與政策。
 * 葉節點（只依賴 core 與 audit-log）：`AuthModule`（登入流程）、`UserModule`（帳號管理）、`TenantModule`
 * （停用租戶）都依賴它；`platform-admin` 只 import 這裡的純函式（`password`、`token-hash`、`refresh-rotation`、
 * `mails/`）。登入流程依賴 `UserModule`，所以這些不能放在 `AuthModule`，否則會形成循環。
 */
@Module({
  // AuthMailJobs：啟用與重設密碼信的背景工作（docs/architecture/backend/11-mail.md §4）
  // AuthTokenCleanupJobs：過期 token 的清理排程（docs/architecture/backend/04-auth.md §8）
  providers: [
    AuthTokenService,
    RefreshTokenService,
    RefreshTokenRepository,
    AuthMailJobs,
    AuthTokenCleanupJobs,
    LoginSourceService,
  ],
  exports: [AuthTokenService, RefreshTokenService, LoginSourceService],
})
export class CredentialModule {
  // 帳號政策的設定在這裡登記：`UserModule` 只匯入這個模組、不匯入 `AuthModule`，也要讀得到
  constructor(settings: SettingService) {
    settings.register(AUTH_SETTINGS);
  }
}
