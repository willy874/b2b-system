import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import type {
  ListWorkspaceMemberDto,
  UpdateWorkspaceMemberRolesDto,
  WorkspaceMemberDto,
  WorkspaceMemberRolesDto,
  WorkspaceRoleListDto,
} from './dto/workspace.dto';
import type { MemberRow } from './workspace.repository';
import { WorkspaceRepository } from './workspace.repository';

function toDto(row: MemberRow): WorkspaceMemberDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    roles: row.roles,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/**
 * 工作區內的成員管理（docs/adr/0018-workspace-tenancy.md D11、D12）：清單、工作區角色指派、移除。
 * 指派受反提權限制：以操作者在 **這個工作區** 的權限集合比對；不能改自己（比照 I9）；
 * 每個工作區至少要留一位持有 `workspaceMember:assignRole` 的成員（在交易內寫入後檢查）。
 */
@Injectable()
export class WorkspaceMemberService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: WorkspaceRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(ws: WorkspaceScope, query: ListWorkspaceMemberDto) {
    const { items, total } = await this.repo.listMembers(ws, query);
    return paginated(items.map(toDto), total, query);
  }

  /** 可以指派的工作區角色（所有 `scope = workspace` 的角色與它們的權限鍵）。 */
  async listRoles(): Promise<WorkspaceRoleListDto> {
    return { items: await this.repo.listWorkspaceRoles() };
  }

  /**
   * 整批取代成員的工作區角色。反提權比對「加上的 ∪ 拿掉的」角色：
   * 不能授予自己沒有的權限，也不能拿掉比自己高的人的角色。
   */
  async updateRoles(
    ws: WorkspaceScope,
    userId: string,
    dto: UpdateWorkspaceMemberRolesDto,
    actor: AuthUser,
  ): Promise<WorkspaceMemberRolesDto> {
    if (userId === actor.id) throw new AppException('AUTHZ_SELF_MODIFY');
    const member = await this.getMember(ws, userId);
    await this.permissions.assertRoleScope(dto.roleIds, 'workspace');
    const before = await this.repo.listMemberRoles(ws, userId);
    const beforeIds = new Set(before.map((role) => role.id));
    const afterIds = new Set(dto.roleIds);
    const touched = [
      ...dto.roleIds.filter((id) => !beforeIds.has(id)),
      ...[...beforeIds].filter((id) => !afterIds.has(id)),
    ];
    await this.permissions.assertWorkspaceRolesAssignable(actor.id, ws.workspaceId, touched);

    await withTransaction(this.db, async (tx) => {
      await this.repo.replaceMemberRoles(ws, userId, dto.roleIds, actor.id, tx);
      await this.assertAdminRemains(ws, tx);
      const after = await this.repo.listMemberRoles(ws, userId, tx);
      await this.audit.record(
        {
          action: 'workspaceMember.assignRole',
          resourceType: 'workspaceMember',
          resourceId: userId,
          resourceName: member.email,
          changes: {
            before: { roles: before.map((role) => role.slug) },
            after: { roles: after.map((role) => role.slug) },
          },
          metadata: { workspaceId: ws.workspaceId },
        },
        tx,
      );
    });

    this.afterChanged(ws, userId, ChangeKind.UPDATE);
    return { roles: await this.repo.listMemberRoles(ws, userId) };
  }

  /** 移除成員；工作區角色一起消失。不能移除自己、不能移除最後一位管理員。 */
  async remove(ws: WorkspaceScope, userId: string, actor: AuthUser): Promise<void> {
    if (userId === actor.id) throw new AppException('AUTHZ_SELF_MODIFY');
    const member = await this.getMember(ws, userId);
    const roles = await this.repo.listMemberRoles(ws, userId);
    // 拿掉的角色受反提權限制：不能移除權限比自己高的人
    await this.permissions.assertWorkspaceRolesAssignable(
      actor.id,
      ws.workspaceId,
      roles.map((role) => role.id),
    );

    await withTransaction(this.db, async (tx) => {
      const removed = await this.repo.removeMember(ws, userId, tx);
      if (!removed) throw new AppException('WORKSPACE_MEMBER_NOT_FOUND');
      await this.assertAdminRemains(ws, tx);
      await this.audit.record(
        {
          action: 'workspaceMember.remove',
          resourceType: 'workspaceMember',
          resourceId: userId,
          resourceName: member.email,
          changes: { before: { roles: roles.map((role) => role.slug) } },
          metadata: { workspaceId: ws.workspaceId },
        },
        tx,
      );
    });

    this.afterChanged(ws, userId, ChangeKind.DELETE);
  }

  private async getMember(ws: WorkspaceScope, userId: string) {
    const member = await this.repo.findMember(ws, userId);
    if (!member) throw new AppException('WORKSPACE_MEMBER_NOT_FOUND', { userId });
    return member;
  }

  /** D12：寫入之後仍至少有一位能管理成員的人，否則整個交易 rollback。 */
  private async assertAdminRemains(ws: WorkspaceScope, tx: DbOrTx): Promise<void> {
    const admins = await this.repo.findMembersWithPermission(
      ws,
      PERMISSION.WORKSPACE_MEMBER_ASSIGN_ROLE,
      tx,
    );
    if (admins.length === 0) throw new AppException('WORKSPACE_LAST_ADMIN');
  }

  private afterChanged(ws: WorkspaceScope, userId: string, kind: ChangeKind): void {
    this.permissions.invalidateUser(userId);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: [userId] });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WORKSPACE_MEMBER, kind, id: userId }],
      affectedUserIds: [userId],
      workspaceId: ws.workspaceId,
    });
  }
}
