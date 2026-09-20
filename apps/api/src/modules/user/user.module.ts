import { Module } from '@nestjs/common';

import { AuthTokenModule } from '@/modules/auth/auth-token.module';

import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [AuthTokenModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService, UserRepository],
})
export class UserModule {}
