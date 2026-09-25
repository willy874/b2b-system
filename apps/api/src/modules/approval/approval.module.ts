import { Module } from '@nestjs/common';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { ApprovalController } from './approval.controller';
import { ApprovalRepository } from './approval.repository';
import { ApprovalService } from './approval.service';

/**
 * 葉節點模組：只依賴 Permission / AuditLog（皆為 @Global）。
 * 擁有資源的業務模組 import 它，並以 `ApprovalService.registerHandler()` 登記自己的 `ApprovalHandler`
 * （docs/rbac/06-approval.md §4）。
 */
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalRepository, ApprovalHandlerRegistry],
  exports: [ApprovalService],
})
export class ApprovalModule {}
