import { Module } from '@nestjs/common';

import { PlatformNotificationCleanupJob } from './platform-notification-cleanup.job';
import { PlatformNotificationController } from './platform-notification.controller';
import { PlatformNotificationRepository } from './platform-notification.repository';
import { PlatformNotificationService } from './platform-notification.service';

/** 平台管理者的站內通知（docs/architecture/backend/15-notification.md §6.2）。只依賴 core；發送端的模組注入 service。 */
@Module({
  controllers: [PlatformNotificationController],
  providers: [
    PlatformNotificationRepository,
    PlatformNotificationService,
    PlatformNotificationCleanupJob,
  ],
  exports: [PlatformNotificationService],
})
export class PlatformNotificationModule {}
