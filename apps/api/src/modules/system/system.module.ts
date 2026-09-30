import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { SystemSettingController } from './system-setting.controller';
import { SystemSettingService } from './system-setting.service';
import { SystemController } from './system.controller';
import { SYSTEM_SETTINGS } from './system.settings';

@Module({
  controllers: [SystemController, SystemSettingController],
  providers: [SystemSettingService],
})
export class SystemModule {
  constructor(settings: SettingService) {
    settings.register(SYSTEM_SETTINGS);
  }
}
