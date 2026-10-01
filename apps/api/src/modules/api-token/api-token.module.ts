import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { ApiTokenUsageService } from './api-token-usage.service';
import { ApiTokenController } from './api-token.controller';
import { ApiTokenRepository } from './api-token.repository';
import { ApiTokenService } from './api-token.service';
import { API_TOKEN_SETTINGS } from './api-token.settings';
import { ApiTokenVerifier } from './api-token.verifier';
import { ApiTokenExternalController } from './external/api-token.external.controller';
import { UserApiTokenController } from './user-api-token.controller';

/**
 * API token（docs/adr/0027-api-tokens-external-api.md）。
 * - 內部 api：個人 token 與管理者看別人的 token；服務帳號的 token 由 `ServiceAccountModule` 經 `ApiTokenService` 管理
 * - 對外 API：`ApiTokenVerifier`、`ApiTokenUsageService` 給 `external-api.module.ts` 的 guard 用；`/v1/me`
 *
 * 兩個程序都註冊全部的 controller，另一邊的由 `SurfaceGuard` 回 404（D11）。
 */
@Module({
  controllers: [ApiTokenController, UserApiTokenController, ApiTokenExternalController],
  providers: [ApiTokenService, ApiTokenRepository, ApiTokenVerifier, ApiTokenUsageService],
  exports: [ApiTokenService, ApiTokenVerifier, ApiTokenUsageService],
})
export class ApiTokenModule {
  constructor(settings: SettingService) {
    settings.register(API_TOKEN_SETTINGS);
  }
}
