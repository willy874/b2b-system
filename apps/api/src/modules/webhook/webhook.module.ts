import { Module } from '@nestjs/common';

import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';

import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEventCatalog } from './webhook-event.catalog';
import { WEBHOOK_PING_EVENT } from './webhook.constants';
import { WebhookController } from './webhook.controller';
import { WebhookJobs } from './webhook.jobs';
import { WEBHOOK_NOTIFICATIONS } from './webhook.notifications';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';
import { WebhookTransport } from './webhook.transport';

/**
 * Webhook（docs/adr/0030-webhooks.md）。不 import 任何發出事件的業務模組：擁有者模組 import 它，
 * 在自己的 constructor 以 `WebhookEventCatalog.register()` 登記事件，在業務交易內呼叫 `WebhookService.emit()`。
 */
@Module({
  imports: [NotificationModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDeliveryService,
    WebhookRepository,
    WebhookEventCatalog,
    WebhookTransport,
    WebhookJobs,
  ],
  exports: [WebhookService, WebhookEventCatalog],
})
export class WebhookModule {
  constructor(catalog: WebhookEventCatalog, notificationEvents: NotificationEventCatalog) {
    catalog.register([WEBHOOK_PING_EVENT]);
    notificationEvents.register(WEBHOOK_NOTIFICATIONS);
  }
}
