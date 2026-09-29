import { Module } from '@nestjs/common';

import { AuthMailJobs } from './auth-mail.jobs';
import { AuthTokenService } from './auth-token.service';
import { RefreshTokenRepository } from './refresh-token.repository';

/**
 * 葉節點：`AuthModule` 與 `UserModule` 都需要簽發 / 撤銷 token，
 * 但 `UserModule` 不該依賴 `AuthModule`（那會與 AuthModule → UserModule 形成循環）。
 * 把 token 的儲存層抽成獨立模組是那個循環的解法。
 */
@Module({
  // AuthMailJobs：啟用與重設密碼信的背景工作（docs/architecture/backend/11-mail.md §4）
  providers: [AuthTokenService, RefreshTokenRepository, AuthMailJobs],
  exports: [AuthTokenService, RefreshTokenRepository],
})
export class AuthTokenModule {}
