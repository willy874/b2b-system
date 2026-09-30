import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { NotificationCleanupJob } from './notification-cleanup.job';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NOTIFICATION_SETTINGS } from './notification.settings';

/**
 * 站內通知（docs/architecture/backend/15-notification.md）。只依賴 core 與 db/schema，不 import 任何業務模組；
 * 產生通知的擁有者模組 import 它，在自己的業務交易內呼叫 `NotificationService.notify()`（ADR-0026 D2）。
 */
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository, NotificationCleanupJob],
  exports: [NotificationService],
})
export class NotificationModule {
  constructor(settings: SettingService) {
    settings.register(NOTIFICATION_SETTINGS);
  }
}
