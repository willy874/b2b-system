import { Global, Module } from '@nestjs/common';

import { AuthzRegistry } from './authz.registry';
import { AuthzRepository } from './authz.repository';
import { AuthzService } from './authz.service';

/** 關係圖引擎（docs/adr/0024-relationship-based-access-control.md）；全域，業務模組直接注入註冊表。 */
@Global()
@Module({
  providers: [AuthzRegistry, AuthzRepository, AuthzService],
  exports: [AuthzRegistry, AuthzService],
})
export class AuthzModule {}
