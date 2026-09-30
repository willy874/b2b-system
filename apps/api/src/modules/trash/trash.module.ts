import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { TrashPurgeJob } from './trash-purge.job';
import { TrashController } from './trash.controller';
import { TrashRegistry } from './trash.registry';
import { TrashService } from './trash.service';
import { TRASH_SETTINGS } from './trash.settings';

/**
 * 回收桶（docs/architecture/backend/13-trash.md）。只依賴 Permission / AuditLog（@Global）與 core；
 * 擁有資源的模組 import 它，並以 `TrashService.registerHandler()` 登記自己的 `TrashHandler`（ADR-0025 D9）。
 */
@Module({
  controllers: [TrashController],
  providers: [TrashService, TrashRegistry, TrashPurgeJob],
  exports: [TrashService],
})
export class TrashModule {
  constructor(settings: SettingService) {
    settings.register(TRASH_SETTINGS);
  }
}
