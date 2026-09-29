import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION, workspaceScopeOf } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { WorkspaceRow } from '@/db/schema';
import { WORKSPACE_ADMIN_SLUG } from '@/db/seeds/roles';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import type {
  AssignWorkspaceAdminDto,
  CreateWorkspaceDto,
  ListWorkspaceDto,
  MyWorkspaceDto,
  MyWorkspaceListDto,
  UpdateWorkspaceDto,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceMeDto,
} from './dto/workspace.dto';
import { slugifyWorkspace, WORKSPACE_AUDIT_FIELDS } from './workspace.constants';
import type { WorkspaceWithCount } from './workspace.repository';
import { WorkspaceRepository } from './workspace.repository';

function toDto(row: WorkspaceWithCount): WorkspaceDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    memberCount: row.memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMine(
  row: WorkspaceRow & { isMember: boolean; lastAccessedAt: Date | null },
): MyWorkspaceDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isMember: row.isMember,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
  };
}

/**
 * 工作區本身（docs/adr/0018-workspace-tenancy.md）：平台管理員的建立、改名、刪除、指定管理員，
 * 以及使用者自己的「能進入哪些工作區」與「在這個工作區是什麼身分」。
 * 平台管理員看得到名稱、成員數與管理員，看不到工作區裡的內容（D5）。
 */
@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: WorkspaceRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  // ── 平台 ────────────────────────────────────────────────

  async list(query: ListWorkspaceDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
  }

  async findOne(id: string): Promise<WorkspaceDetailDto> {
    const row = await this.getExisting(id);
    const admins = await this.repo.findMembersWithPermission(
      workspaceScopeOf(id),
      PERMISSION.WORKSPACE_MEMBER_ASSIGN_ROLE,
    );
    return { ...toDto(row), admins };
  }

  /**
   * 建立工作區，並把 `adminUserId` 加為第一位管理員（系統角色 `workspace-admin`）。
   * 建立者在新工作區裡沒有任何權限，這一步豁免反提權（D13）。
   */
  async create(dto: CreateWorkspaceDto, actor: AuthUser): Promise<WorkspaceDetailDto> {
    const [admin] = await this.repo.findUsers([dto.adminUserId]);
    if (!admin) throw new AppException('USER_NOT_FOUND', { userId: dto.adminUserId });
    const slug = dto.slug ?? (await this.uniqueSlug(slugifyWorkspace(dto.name)));
    if (dto.slug && (await this.repo.findBySlug(dto.slug))) {
      throw new AppException('WORKSPACE_SLUG_DUPLICATE', { field: 'slug', value: dto.slug });
    }

    const created = await this.writeUnique(async (tx) => {
      const row = await this.repo.create(
        {
          slug,
          name: dto.name,
          description: dto.description ?? null,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'workspace.create',
          resourceType: 'workspace',
          resourceId: row.id,
          resourceName: row.name,
          changes: { after: { slug: row.slug, name: row.name, adminUserId: admin.id } },
        },
        tx,
      );
      await this.designateAdmin(workspaceScopeOf(row.id), row, admin, actor, tx);
      return row;
    });

    this.afterMembershipChanged(created.id, [admin.id]);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WORKSPACE, kind: ChangeKind.CREATE, id: created.id }],
      affectedUserIds: [admin.id],
    });
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateWorkspaceDto, actor: AuthUser): Promise<WorkspaceDetailDto> {
    const existing = await this.getExisting(id);
    const changes = diff(existing, dto, [...WORKSPACE_AUDIT_FIELDS]);
    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, { ...dto, updatedBy: actor.id }, tx);
      if (!updated) throw new AppException('WORKSPACE_NOT_FOUND');
      await this.audit.record(
        {
          action: 'workspace.update',
          resourceType: 'workspace',
          resourceId: id,
          resourceName: updated.name,
          changes,
        },
        tx,
      );
    });
    // 成員的工作區切換器顯示名稱
    const members = await this.repo.findMemberIds(workspaceScopeOf(id));
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WORKSPACE, kind: ChangeKind.UPDATE, id }],
      affectedUserIds: members,
    });
    return this.findOne(id);
  }

  /** 軟刪除：資料留著（這一版不做硬刪除與清除），成員立刻進不去。 */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const existing = await this.getExisting(id);
    const ws = workspaceScopeOf(id);
    const members = await this.repo.findMemberIds(ws);
    await withTransaction(this.db, async (tx) => {
      const deleted = await this.repo.softDelete(id, actor.id, tx);
      if (!deleted) throw new AppException('WORKSPACE_NOT_FOUND');
      await this.audit.record(
        {
          action: 'workspace.delete',
          resourceType: 'workspace',
          resourceId: id,
          resourceName: existing.name,
          changes: { before: { slug: existing.slug, name: existing.name } },
          metadata: { memberCount: existing.memberCount },
        },
        tx,
      );
    });
    this.permissions.invalidateWorkspace(id);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: members });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WORKSPACE, kind: ChangeKind.DELETE, id }],
      affectedUserIds: members,
    });
  }

  /**
   * 指定管理員（D12）：最後一位管理員被刪除之後的補救，也可以用在任何時候。
   * 對象加入成員（還不是的話）並取得 `workspace-admin`；留下稽核。
   */
  async assignAdmin(
    id: string,
    dto: AssignWorkspaceAdminDto,
    actor: AuthUser,
  ): Promise<WorkspaceDetailDto> {
    const workspace = await this.getExisting(id);
    const [user] = await this.repo.findUsers([dto.userId]);
    if (!user) throw new AppException('USER_NOT_FOUND', { userId: dto.userId });
    await withTransaction(this.db, (tx) =>
      this.designateAdmin(workspaceScopeOf(id), workspace, user, actor, tx),
    );
    this.afterMembershipChanged(id, [user.id]);
    return this.findOne(id);
  }

  // ── 使用者自己 ───────────────────────────────────────────

  /** 能進入的工作區：成員的；super-admin 是全部（D5）。 */
  async listMine(actor: AuthUser): Promise<MyWorkspaceListDto> {
    const { isSuperAdmin } = await this.permissions.getPermissionSet(actor.id);
    const rows = await this.repo.listEnterable(actor.id, isSuperAdmin);
    return { items: rows.map(toMine) };
  }

  /** 在這個工作區的身分；同時記下「最近進入」，登入後預設開啟最近用過的工作區。 */
  async me(ws: WorkspaceScope, actor: AuthUser): Promise<WorkspaceMeDto> {
    const [workspace, roles, permissions] = await Promise.all([
      this.getExisting(ws.workspaceId),
      this.repo.listMemberRoles(ws, actor.id),
      this.permissions.getEffectiveWorkspacePermissionKeys(actor.id, ws.workspaceId),
    ]);
    const member = await this.repo.findMember(ws, actor.id);
    if (member) await this.repo.touchLastAccessed(ws, actor.id);
    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        description: workspace.description,
        isMember: Boolean(member),
        lastAccessedAt: new Date().toISOString(),
      },
      roles,
      permissions,
    };
  }

  // ── 內部 ─────────────────────────────────────────────────

  private async getExisting(id: string): Promise<WorkspaceWithCount> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('WORKSPACE_NOT_FOUND');
    return row;
  }

  /** 對象成為成員並取得 `workspace-admin`（與建立工作區、指定管理員共用），寫稽核。 */
  private async designateAdmin(
    ws: WorkspaceScope,
    workspace: { id: string; name: string },
    user: { id: string; email: string },
    actor: AuthUser,
    tx: DbOrTx,
  ): Promise<void> {
    const role = await this.repo.findRoleBySlug(WORKSPACE_ADMIN_SLUG, tx);
    if (!role) throw new Error(`系統角色 ${WORKSPACE_ADMIN_SLUG} 不存在，請先執行 db:seed`);
    const joined = await this.repo.addMember(ws, user.id, actor.id, tx);
    await this.repo.addMemberRole(ws, user.id, role.id, actor.id, tx);
    await this.audit.record(
      {
        action: 'workspace.assignAdmin',
        resourceType: 'workspace',
        resourceId: workspace.id,
        resourceName: workspace.name,
        changes: { after: { userId: user.id, email: user.email, role: WORKSPACE_ADMIN_SLUG } },
        metadata: { joined },
      },
      tx,
    );
  }

  /** 成員資格或工作區角色變了：快取失效在交易後，接著發事件（CLAUDE.md 後端規則 6）。 */
  private afterMembershipChanged(workspaceId: string, userIds: string[]): void {
    this.permissions.invalidateUsers(userIds);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: userIds.map((id) => ({
        resource: ChangeSource.WORKSPACE_MEMBER,
        kind: ChangeKind.UPDATE,
        id,
      })),
      affectedUserIds: userIds,
      workspaceId,
    });
  }

  /** slug 的唯一索引：預檢查與寫入之間被搶先時也回業務錯誤。 */
  private async writeUnique<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, work);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('WORKSPACE_SLUG_DUPLICATE');
      throw error;
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    const existing = new Set(await this.repo.findSlugsLike(base));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new AppException('WORKSPACE_SLUG_DUPLICATE', { field: 'slug' });
  }
}
