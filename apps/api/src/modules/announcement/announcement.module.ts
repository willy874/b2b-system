import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { AnnouncementDispatchService } from './announcement-dispatch.service';
import { AnnouncementMessageController } from './announcement-message.controller';
import { AnnouncementTrashHandler } from './announcement-trash.handler';
import { AnnouncementTriggerCatalog } from './announcement-trigger.catalog';
import { AnnouncementTriggerService } from './announcement-trigger.service';
import { AnnouncementAudienceResolver } from './announcement.audience';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementJobs } from './announcement.jobs';
import { ANNOUNCEMENT_NOTIFICATIONS } from './announcement.notifications';
import { AnnouncementRepository } from './announcement.repository';
import { AnnouncementScheduler } from './announcement.scheduler';
import { AnnouncementService } from './announcement.service';
import { ANNOUNCEMENT_SETTINGS } from './announcement.settings';

/**
 * 公告與排程通知（docs/adr/0031-announcements.md）。發送經由 `NotificationService.notify()`（每人一筆、分批），
 * 受眾經由 `AuthzService` 反向展開；不 import 其他業務模組。事件點反過來：擁有者 import 這個模組，
 * 在自己的 constructor 以 `AnnouncementTriggerCatalog.register()` 登記、在業務交易內呼叫 `AnnouncementTriggerService.fire()`。
 */
@Module({
  imports: [NotificationModule, TrashModule],
  controllers: [AnnouncementController, AnnouncementMessageController],
  providers: [
    AnnouncementService,
    AnnouncementDispatchService,
    AnnouncementRepository,
    AnnouncementAudienceResolver,
    AnnouncementScheduler,
    AnnouncementTriggerCatalog,
    AnnouncementTriggerService,
    AnnouncementJobs,
    AnnouncementTrashHandler,
  ],
  // 擁有者模組（使用者、群組）登記觸發點並在業務交易內呼叫 fire()（ADR-0031 D12）
  exports: [AnnouncementTriggerCatalog, AnnouncementTriggerService],
})
export class AnnouncementModule {
  constructor(notificationEvents: NotificationEventCatalog, settings: SettingService) {
    notificationEvents.register(ANNOUNCEMENT_NOTIFICATIONS);
    settings.register(ANNOUNCEMENT_SETTINGS);
  }
}
