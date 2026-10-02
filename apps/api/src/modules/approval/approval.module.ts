import { Module } from '@nestjs/common';

import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { WebhookEventCatalog } from '@/modules/webhook/webhook-event.catalog';
import { WebhookModule } from '@/modules/webhook/webhook.module';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { ApprovalResultMailJob } from './approval-result-mail.job';
import { ApprovalController } from './approval.controller';
import { APPROVAL_NOTIFICATIONS } from './approval.notifications';
import { ApprovalRepository } from './approval.repository';
import { ApprovalService } from './approval.service';
import { APPROVAL_WEBHOOK_EVENTS } from './approval.webhooks';

/**
 * 葉節點模組：只依賴 Permission / AuditLog（皆為 @Global）與 Notification、Webhook（通用模組，不依賴業務模組）。
 * 擁有資源的業務模組 import 它，並以 `ApprovalService.registerHandler()` 登記自己的 `ApprovalHandler`
 * （docs/rbac/06-approval.md §4）。
 */
@Module({
  imports: [NotificationModule, WebhookModule],
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalRepository, ApprovalHandlerRegistry, ApprovalResultMailJob],
  exports: [ApprovalService],
})
export class ApprovalModule {
  constructor(notificationEvents: NotificationEventCatalog, webhookEvents: WebhookEventCatalog) {
    notificationEvents.register(APPROVAL_NOTIFICATIONS);
    webhookEvents.register(APPROVAL_WEBHOOK_EVENTS);
  }
}
