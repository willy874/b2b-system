import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';

import { NotificationCleanupJob } from './notification-cleanup.job';
import { NotificationEventCatalog } from './notification-event.catalog';
import { NotificationEventController } from './notification-event.controller';
import { NotificationOverviewController } from './notification-overview.controller';
import { NotificationPolicyRepository } from './notification-policy.repository';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationPreferenceController } from './notification-preference.controller';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NOTIFICATION_SETTINGS } from './notification.settings';

/**
 * 站內通知（docs/architecture/backend/15-notification.md）。只依賴 core 與 db/schema，不 import 任何業務模組；
 * 產生通知的擁有者模組 import 它，在自己的 constructor 以 `NotificationEventCatalog.register()` 登記事件，
 * 在業務交易內呼叫 `NotificationService.notify()`（ADR-0026 D2、ADR-0028 D2）。
 */
@Module({
  controllers: [
    NotificationController,
    NotificationOverviewController,
    NotificationEventController,
    NotificationPreferenceController,
  ],
  providers: [
    NotificationService,
    NotificationRepository,
    NotificationCleanupJob,
    NotificationEventCatalog,
    NotificationPolicyService,
    NotificationPolicyRepository,
    NotificationPreferenceService,
    NotificationPreferenceRepository,
  ],
  exports: [NotificationService, NotificationEventCatalog],
})
export class NotificationModule {
  constructor(settings: SettingService) {
    settings.register(NOTIFICATION_SETTINGS);
  }
}
