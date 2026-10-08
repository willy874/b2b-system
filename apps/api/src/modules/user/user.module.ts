import { Module } from '@nestjs/common';

import { AnnouncementTriggerCatalog } from '@/modules/announcement/announcement-trigger.catalog';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { ApprovalModule } from '@/modules/approval/approval.module';
import { CredentialModule } from '@/modules/credential/credential.module';
import { DataTransferModule } from '@/modules/data-transfer/data-transfer.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { OrganizationModule } from '@/modules/organization/organization.module';
import { TagModule } from '@/modules/tag/tag.module';
import { TrashModule } from '@/modules/trash/trash.module';
import { WebhookEventCatalog } from '@/modules/webhook/webhook-event.catalog';
import { WebhookModule } from '@/modules/webhook/webhook.module';

import { UserExternalController } from './external/user.external.controller';
import { UserExternalService } from './external/user.external.service';
import { UserAccountService } from './user-account.service';
import { UserLoginService } from './user-login.service';
import { UserRegistrationApprovalHandler } from './user-registration.approval';
import { UserTagResource } from './user-tag.resource';
import { UserTrashHandler } from './user-trash.handler';
import { USER_ANNOUNCEMENT_TRIGGERS } from './user.announcement-triggers';
import { UserController } from './user.controller';
import { USER_NOTIFICATIONS } from './user.notifications';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { UserTransferResource } from './user.transfer';
import { USER_WEBHOOK_EVENTS } from './user.webhooks';

@Module({
  imports: [
    CredentialModule,
    ApprovalModule,
    IdentityProviderModule,
    TrashModule,
    NotificationModule,
    WebhookModule,
    TagModule,
    AnnouncementModule,
    DataTransferModule,
    OrganizationModule,
  ],
  // 對外 API 的 controller 也在這裡，另一邊由 SurfaceGuard 回 404（docs/architecture/06-external-api.md §9.2 D11）
  controllers: [UserController, UserExternalController],
  providers: [
    UserService,
    UserAccountService,
    UserLoginService,
    UserRepository,
    UserRegistrationApprovalHandler,
    UserTrashHandler,
    UserTagResource,
    UserExternalService,
    UserTransferResource,
  ],
  // 管理端點（UserService）、登入流程等其他模組用的帳號讀寫（UserAccountService）與密碼登入的檢查（UserLoginService）
  exports: [UserService, UserAccountService, UserLoginService],
})
export class UserModule {
  constructor(
    notificationEvents: NotificationEventCatalog,
    webhookEvents: WebhookEventCatalog,
    announcementTriggers: AnnouncementTriggerCatalog,
  ) {
    notificationEvents.register(USER_NOTIFICATIONS);
    webhookEvents.register(USER_WEBHOOK_EVENTS);
    announcementTriggers.register(USER_ANNOUNCEMENT_TRIGGERS);
  }
}
