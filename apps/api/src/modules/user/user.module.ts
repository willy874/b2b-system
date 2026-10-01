import { Module } from '@nestjs/common';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { CredentialModule } from '@/modules/credential/credential.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { UserExternalController } from './external/user.external.controller';
import { UserExternalService } from './external/user.external.service';
import { UserRegistrationApprovalHandler } from './user-registration.approval';
import { UserTrashHandler } from './user-trash.handler';
import { UserController } from './user.controller';
import { USER_NOTIFICATIONS } from './user.notifications';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [
    CredentialModule,
    ApprovalModule,
    IdentityProviderModule,
    TrashModule,
    NotificationModule,
  ],
  // 對外 API 的 controller 也在這裡，另一邊由 SurfaceGuard 回 404（docs/adr/0027-api-tokens-external-api.md D11）
  controllers: [UserController, UserExternalController],
  providers: [
    UserService,
    UserRepository,
    UserRegistrationApprovalHandler,
    UserTrashHandler,
    UserExternalService,
  ],
  exports: [UserService],
})
export class UserModule {
  constructor(notificationEvents: NotificationEventCatalog) {
    notificationEvents.register(USER_NOTIFICATIONS);
  }
}
