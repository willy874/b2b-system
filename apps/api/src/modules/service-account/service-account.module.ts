import { Module } from '@nestjs/common';

import { ApiTokenModule } from '@/modules/api-token/api-token.module';

import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountRepository } from './service-account.repository';
import { ServiceAccountService } from './service-account.service';

/** 服務帳號（docs/architecture/06-external-api.md §9.2 D1）：它的 token 經 `ApiTokenService` 管理。 */
@Module({
  imports: [ApiTokenModule],
  controllers: [ServiceAccountController],
  providers: [ServiceAccountService, ServiceAccountRepository],
})
export class ServiceAccountModule {}
