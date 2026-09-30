import { Module } from '@nestjs/common';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { CredentialModule } from '@/modules/credential/credential.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';

import { UserRegistrationApprovalHandler } from './user-registration.approval';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [CredentialModule, ApprovalModule, IdentityProviderModule],
  controllers: [UserController],
  providers: [UserService, UserRepository, UserRegistrationApprovalHandler],
  exports: [UserService],
})
export class UserModule {}
