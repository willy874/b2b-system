import { Global, Module } from '@nestjs/common';

import { SettingRepository } from './setting.repository';
import { SettingService } from './setting.service';

/** 執行期可調的設定（docs/architecture/backend/12-settings.md）；各模組注入 `SettingService` 登記與讀取。 */
@Global()
@Module({
  providers: [SettingRepository, SettingService],
  exports: [SettingService],
})
export class SettingsModule {}
