import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { AuthzService } from '@/core/authz';
import type { DbOrTx } from '@/core/database';
import { requireTenant } from '@/core/tenant';
import { GROUP_MEMBER_RELATION, GROUP_OBJECT_TYPE } from '@/db/schema';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalAssigneeRegistry } from './approval-assignee.registry';
import { ApprovalChainRepository } from './approval-chain.repository';

/**
 * 審批內建的三種審核者規則：指定的使用者、群組（含巢狀）、角色的持有者（直接 ＋ 經由群組）
 * （docs/architecture/backend/20-approval.md §9.2）。與權限解析走同一張關係圖：群組停用時成員關係暫停，
 * `group` 展開為空、`role` 只剩直接持有的人（docs/architecture/iam/07-groups.md §8）。
 */
@Injectable()
export class BuiltinAssigneeResolvers implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalAssigneeRegistry,
    private readonly repo: ApprovalChainRepository,
    private readonly authz: AuthzService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      kind: 'user',
      isAvailable: () => true,
      resolve: async (rule) => [rule.id],
      describe: async (rule) => {
        const user = (await this.repo.userNames([rule.id])).get(rule.id);
        return user ? { label: user.name, deleted: user.deleted } : { label: '', deleted: true };
      },
    });
    this.registry.register({
      kind: 'group',
      isAvailable: () => requireTenant().features.includes('group'),
      resolve: (rule, _ctx, tx?: DbOrTx) =>
        this.authz.usersInSubjectSets(
          [{ type: GROUP_OBJECT_TYPE, id: rule.id, relation: GROUP_MEMBER_RELATION }],
          { tx },
        ),
      describe: async (rule) => {
        const group = await this.repo.groupName(rule.id);
        return group ? { label: group.name, deleted: group.deleted } : { label: '', deleted: true };
      },
    });
    this.registry.register({
      kind: 'role',
      isAvailable: () => true,
      resolve: (rule, _ctx, tx?: DbOrTx) => this.permissions.findUserIdsHoldingRole(rule.id, tx),
      describe: async (rule) => {
        const role = await this.repo.roleName(rule.id);
        return role ? { label: role.name, deleted: role.deleted } : { label: '', deleted: true };
      },
    });
  }
}
