import { Module } from '@nestjs/common';

import { TenantFeatureImpacts } from '@/core/tenant';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { WebhookEventCatalog } from '@/modules/webhook/webhook-event.catalog';
import { WebhookModule } from '@/modules/webhook/webhook.module';

import { ApprovalAssigneeRegistry } from './approval-assignee.registry';
import { BuiltinAssigneeResolvers } from './approval-assignee.resolvers';
import { ApprovalChainRepository } from './approval-chain.repository';
import { ApprovalChainService } from './approval-chain.service';
import { ApprovalFinalizer } from './approval-finalizer.service';
import { ApprovalFlowController } from './approval-flow.controller';
import { ApprovalFlowService } from './approval-flow.service';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { ApprovalResultMailJob } from './approval-result-mail.job';
import { ApprovalController } from './approval.controller';
import { APPROVAL_NOTIFICATIONS } from './approval.notifications';
import { ApprovalRepository } from './approval.repository';
import { ApprovalService } from './approval.service';
import { APPROVAL_WEBHOOK_EVENTS } from './approval.webhooks';

/**
 * 通用模組：只依賴 Permission / AuditLog（皆為 @Global）與 Notification、Webhook（同為通用模組，不依賴業務模組）。
 * 擁有資源的業務模組 import 它，並以 `ApprovalService.registerHandler()` 登記自己的 `ApprovalHandler`
 * （docs/architecture/backend/20-approval.md §4）；審核者規則以 `registerAssigneeResolver()` 登記（§9.2，例：組織管理）。
 */
@Module({
  imports: [NotificationModule, WebhookModule],
  controllers: [ApprovalController, ApprovalFlowController],
  providers: [
    ApprovalService,
    ApprovalRepository,
    ApprovalHandlerRegistry,
    ApprovalResultMailJob,
    ApprovalAssigneeRegistry,
    BuiltinAssigneeResolvers,
    ApprovalChainRepository,
    ApprovalChainService,
    ApprovalFinalizer,
    ApprovalFlowService,
  ],
  exports: [ApprovalService, ApprovalFlowService],
})
export class ApprovalModule {
  constructor(
    notificationEvents: NotificationEventCatalog,
    webhookEvents: WebhookEventCatalog,
    impacts: TenantFeatureImpacts,
    flows: ApprovalFlowService,
  ) {
    notificationEvents.register(APPROVAL_NOTIFICATIONS);
    webhookEvents.register(APPROVAL_WEBHOOK_EVENTS);
    // 平台關閉 `approvalChain` 前的確認框列出的數量（docs/architecture/backend/20-approval.md §9.11）
    impacts.register('approvalChain', async () => {
      const impact = await flows.countImpact();
      return { approvalFlows: impact.flows, approvalRequestsInChain: impact.inChain };
    });
  }
}
