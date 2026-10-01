import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { ApiTokenController } from './api-token.controller';
import { ApiTokenRepository } from './api-token.repository';
import { ApiTokenService } from './api-token.service';
import { API_TOKEN_SETTINGS } from './api-token.settings';
import { UserApiTokenController } from './user-api-token.controller';

/**
 * API token 的管理（docs/adr/0027-api-tokens-external-api.md）。個人 token 與管理者看別人的 token 在這裡；
 * 服務帳號的 token 由 `ServiceAccountModule` 經 `ApiTokenService` 管理。驗證 token 在對外 API。
 */
@Module({
  controllers: [ApiTokenController, UserApiTokenController],
  providers: [ApiTokenService, ApiTokenRepository],
  exports: [ApiTokenService],
})
export class ApiTokenModule {
  constructor(settings: SettingService) {
    settings.register(API_TOKEN_SETTINGS);
  }
}
