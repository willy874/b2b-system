import { Module } from '@nestjs/common';

import { AuthzExplainController } from './authz-explain.controller';
import { AuthzExplainRepository } from './authz-explain.repository';
import { AuthzExplainService } from './authz-explain.service';

/** 「為什麼能做 X」的說明（docs/rbac/01-domain-model.md §9 G4b）。擁有資源的模組（檔案）以 `describePaths` 的 resolver 補上自己的節點。 */
@Module({
  controllers: [AuthzExplainController],
  providers: [AuthzExplainService, AuthzExplainRepository],
  exports: [AuthzExplainService],
})
export class AuthzExplainModule {}
