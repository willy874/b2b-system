import { Module } from '@nestjs/common';

import { PlatformFeatureFlagController } from './platform-feature-flag.controller';
import { PlatformFeatureFlagRepository } from './platform-feature-flag.repository';
import { PlatformFeatureFlagService } from './platform-feature-flag.service';

/**
 * feature flag 的平台管理 API（docs/adr/0022-feature-flags.md D8）。目錄與判斷在 `core/feature-flags`；
 * 租戶層的覆寫隨租戶管理（`modules/tenant`）。
 */
@Module({
  controllers: [PlatformFeatureFlagController],
  providers: [PlatformFeatureFlagService, PlatformFeatureFlagRepository],
})
export class FeatureFlagModule {}
