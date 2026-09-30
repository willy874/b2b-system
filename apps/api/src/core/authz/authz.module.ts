import { Global, Module } from '@nestjs/common';

import { AuthzRegistry } from './authz.registry';

/** 關係圖引擎（docs/adr/0024-relationship-based-access-control.md）；全域，業務模組直接注入註冊表。 */
@Global()
@Module({
  providers: [AuthzRegistry],
  exports: [AuthzRegistry],
})
export class AuthzModule {}
