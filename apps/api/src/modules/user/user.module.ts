import { Module } from '@nestjs/common';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { AuthTokenModule } from '@/modules/auth/auth-token.module';

import { UserRegistrationApprovalHandler } from './user-registration.approval';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [AuthTokenModule, ApprovalModule],
  controllers: [UserController],
  providers: [UserService, UserRepository, UserRegistrationApprovalHandler],
  exports: [UserService],
})
export class UserModule {}
