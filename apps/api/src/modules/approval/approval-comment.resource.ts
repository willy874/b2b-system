import { ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { RESOURCE_TYPE } from '@/core/resource';
import type { ApprovalRequestRow } from '@/db/schema';
import { CommentService } from '@/modules/comment/comment.service';
import type { CommentTarget } from '@/modules/comment/comment.types';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalChainRepository } from './approval-chain.repository';
import { ApprovalChainService } from './approval-chain.service';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_PERMISSIONS } from './approval.constants';
import { approvalTaskLink } from './approval.notifications';
import { ApprovalRepository } from './approval.repository';

/**
 * 審批請求可以留言與關注（docs/architecture/backend/20-approval.md §11、docs/architecture/backend/24-comment.md §1）：
 * 看得到請求（§9.10：`approval:read`、申請人、任一關的候選人）就能讀與寫留言。定案後照常可以留言（§12 D4）。
 */
@Injectable()
export class ApprovalCommentResource implements OnModuleInit {
  constructor(
    private readonly comments: CommentService,
    private readonly repo: ApprovalRepository,
    private readonly chainRepo: ApprovalChainRepository,
    private readonly chain: ApprovalChainService,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.comments.registerResource({
      resourceType: RESOURCE_TYPE.APPROVAL,
      changeSource: ChangeSource.APPROVAL,
      // 可見性是請求層級的，與 `GET /approvals/:id` 相同：看不到時一律 404，不透露請求存在
      resolveViewable: async (actor, id) => {
        const request = await this.repo.findById(id);
        if (!request || !(await this.chain.canView(request, actor))) {
          throw new AppException('APPROVAL_NOT_FOUND');
        }
        return this.targetOf(request);
      },
      describe: async (id) => {
        const request = await this.repo.findById(id);
        return request && this.targetOf(request);
      },
      filterViewers: async (id, userIds) => {
        const request = await this.repo.findById(id);
        if (!request) return [];
        const [sets, candidates] = await Promise.all([
          this.permissions.getPermissionSets(userIds),
          this.chainRepo.candidatesAmong(id, userIds),
        ]);
        const candidateSet = new Set(candidates);
        return userIds.filter((userId) => {
          if (userId === request.requesterId || candidateSet.has(userId)) return true;
          const set = sets.get(userId);
          return (
            set !== undefined &&
            (set.isSuperAdmin || set.permissions.has(APPROVAL_PERMISSIONS.READ))
          );
        });
      },
    });
  }

  private targetOf(request: ApprovalRequestRow): CommentTarget {
    return {
      name: this.handlers.get(request.type).summarize(request.payload),
      // 「我的審批」的詳情：申請人與候選人沒有 approval:read 也打得開
      link: approvalTaskLink(request.id),
    };
  }
}
