import { Module } from '@nestjs/common';

import { CdnHealthService } from './cdn-health.service';
import { CdnManualPurgeService } from './cdn-manual-purge.service';
import { PlatformCdnSettingsService } from './platform-cdn-settings.service';
import { PlatformCdnController } from './platform-cdn.controller';
import { PlatformCdnRepository } from './platform-cdn.repository';

/**
 * CDN 的平台管理（docs/architecture/backend/09-file.md §16.9～§16.12）：執行期設定的寫入、邊緣的檢查與 `cdn.healthCheck`、手動清理。
 * 生效值的快取與讀取在 `core/storage`（`CdnSettings`、`CdnConfig`），簽章與清理不認識這個模組。
 */
@Module({
  controllers: [PlatformCdnController],
  providers: [
    PlatformCdnRepository,
    PlatformCdnSettingsService,
    CdnHealthService,
    CdnManualPurgeService,
  ],
})
export class PlatformCdnModule {}
