import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { AnnouncementDispatchService } from './announcement-dispatch.service';
import { AnnouncementMessageController } from './announcement-message.controller';
import { AnnouncementTrashHandler } from './announcement-trash.handler';
import { AnnouncementAudienceResolver } from './announcement.audience';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementJobs } from './announcement.jobs';
import { ANNOUNCEMENT_NOTIFICATIONS } from './announcement.notifications';
import { AnnouncementRepository } from './announcement.repository';
import { AnnouncementService } from './announcement.service';
import { ANNOUNCEMENT_SETTINGS } from './announcement.settings';

/**
 * 公告與排程通知（docs/adr/0031-announcements.md）。發送經由 `NotificationService.notify()`（每人一筆、分批），
 * 受眾經由 `AuthzService` 反向展開；不 import 其他業務模組。
 */
@Module({
  imports: [NotificationModule, TrashModule],
  controllers: [AnnouncementController, AnnouncementMessageController],
  providers: [
    AnnouncementService,
    AnnouncementDispatchService,
    AnnouncementRepository,
    AnnouncementAudienceResolver,
    AnnouncementJobs,
    AnnouncementTrashHandler,
  ],
})
export class AnnouncementModule {
  constructor(notificationEvents: NotificationEventCatalog, settings: SettingService) {
    notificationEvents.register(ANNOUNCEMENT_NOTIFICATIONS);
    settings.register(ANNOUNCEMENT_SETTINGS);
  }
}
