import { Global, Module } from '@nestjs/common';

import { AuthzRegistry } from './authz.registry';
import { AuthzRepository } from './authz.repository';
import { AuthzRevision } from './authz.revision';
import { AuthzService } from './authz.service';

/** 關係圖引擎（docs/rbac/01-domain-model.md §9）；全域，業務模組直接注入註冊表。 */
@Global()
@Module({
  providers: [AuthzRegistry, AuthzRepository, AuthzService, AuthzRevision],
  exports: [AuthzRegistry, AuthzService, AuthzRevision],
})
export class AuthzModule {}
