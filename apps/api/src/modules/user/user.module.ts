import { Module } from '@nestjs/common';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { CredentialModule } from '@/modules/credential/credential.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';
import { NotificationModule } from '@/modules/notification/notification.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { UserRegistrationApprovalHandler } from './user-registration.approval';
import { UserTrashHandler } from './user-trash.handler';
import { UserController } from './user.controller';
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
  controllers: [UserController],
  providers: [UserService, UserRepository, UserRegistrationApprovalHandler, UserTrashHandler],
  exports: [UserService],
})
export class UserModule {}
