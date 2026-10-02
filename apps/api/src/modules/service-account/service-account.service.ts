import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import { ApiTokenService } from '@/modules/api-token/api-token.service';
import type {
  ApiTokenDto,
  CreateApiTokenDto,
  CreatedApiTokenDto,
} from '@/modules/api-token/dto/api-token.dto';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import type {
  CreateServiceAccountDto,
  ListServiceAccountDto,
  ReplaceServiceAccountRolesDto,
  ServiceAccountDto,
  UpdateServiceAccountDto,
} from './dto/service-account.dto';
import { SERVICE_ACCOUNT_AUDIT_FIELDS, serviceAccountEmail } from './service-account.constants';
import type { ServiceAccountRoleSummary, ServiceAccountRow } from './service-account.repository';
import { ServiceAccountRepository } from './service-account.repository';

function toDto(row: ServiceAccountRow): ServiceAccountDto {
  return {
    id: row.id,
    name: row.displayName,
    // 服務帳號只會是 active 或 inactive（不登入，沒有 pending、locked）
    status: row.status === 'active' ? 'active' : 'inactive',
    roles: row.roles,
    activeTokenCount: row.activeTokenCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sameIds(
  roles: readonly Pick<ServiceAccountRoleSummary, 'id'>[],
  ids: readonly string[],
): boolean {
  const expected = new Set(ids);
  return roles.length === expected.size && roles.every((role) => expected.has(role.id));
}

/**
 * 服務帳號（docs/architecture/06-external-api.md §9.2 D1、D4～D6、D14）：租戶內的非人類帳號，屬於租戶、不屬於建立者。
 * 它是 `users` 的一列（`kind = 'service'`），角色、權限快取、稽核的 `actor_id` 與人共用；
 * 沒有密碼、不寄信、不進回收桶（刪除後不能還原）。
 */
@Injectable()
export class ServiceAccountService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ServiceAccountRepository,
    private readonly permissions: PermissionService,
    private readonly tokens: ApiTokenService,
    private readonly audit: AuditService,
    private readonly userCache: UserCacheService,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: ListServiceAccountDto): Promise<PaginatedResult<ServiceAccountDto>> {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
  }

  async findOne(id: string): Promise<ServiceAccountDto> {
    return toDto(await this.getExisting(id));
  }

  /** 建立時指派的角色受反提權限制（與指派給人相同）。 */
  async create(dto: CreateServiceAccountDto, actor: AuthUser): Promise<ServiceAccountDto> {
    await this.permissions.assertRolesAssignable(actor.id, dto.roleIds);
    const roles = await this.assertRolesExist(dto.roleIds);
    const id = randomUUID();
    await withTransaction(this.db, async (tx) => {
      await this.repo.create(
        {
          id,
          email: serviceAccountEmail(id),
          displayName: dto.name,
          status: 'active',
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.repo.assignRoles(id, dto.roleIds, actor.id, tx);
      await this.audit.record(
        {
          action: 'serviceAccount.create',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: id,
          resourceName: dto.name,
          changes: { after: { name: dto.name, roles: roles.map((role) => role.slug) } },
        },
        tx,
      );
    });
    if (dto.roleIds.length) await this.permissions.permissionsChanged([id]);
    this.publish(ChangeKind.CREATE, id, dto.roleIds);
    return this.findOne(id);
  }

  /** 改名、停用、啟用。停用時它的 token 全部失效（D5），再啟用不會回來。 */
  async update(
    id: string,
    dto: UpdateServiceAccountDto,
    actor: AuthUser,
  ): Promise<ServiceAccountDto> {
    const current = await this.getExisting(id);
    await this.assertCanManage(actor, id);
    const values = {
      ...(dto.name !== undefined ? { displayName: dto.name } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      updatedBy: actor.id,
    };
    const deactivating = dto.status === 'inactive' && current.status !== 'inactive';
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.update(id, values, dto.version, deactivating, tx);
      if (!row) {
        throw new AppException('SERVICE_ACCOUNT_VERSION_CONFLICT', { current: current.version });
      }
      const changes = diff(
        { name: current.displayName, status: current.status },
        { name: row.displayName, status: row.status },
        SERVICE_ACCOUNT_AUDIT_FIELDS,
      );
      await this.audit.record(
        {
          action: 'serviceAccount.update',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: id,
          resourceName: row.displayName,
          changes,
          metadata: deactivating ? { tokensInvalidated: current.activeTokenCount } : undefined,
        },
        tx,
      );
    });
    // 停用：本機與其他程序的使用者快取都要立即失效，對外 API 才不會再接受它的 token
    this.userCache.invalidate(id);
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /** 軟刪除：它的 token 全部失效並標成撤銷；不進回收桶，不能還原。 */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const current = await this.getExisting(id);
    await this.assertCanManage(actor, id);
    await withTransaction(this.db, async (tx) => {
      await this.repo.softDelete(id, actor.id, tx);
      const revoked = await this.tokens.revokeAllInTransaction(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'serviceAccount.delete',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: id,
          resourceName: current.displayName,
          changes: { before: { name: current.displayName, status: current.status } },
          metadata: { tokensRevoked: revoked },
        },
        tx,
      );
    });
    this.userCache.invalidate(id);
    this.permissions.invalidateUser(id);
    // 角色的持有者人數變了
    this.publish(
      ChangeKind.DELETE,
      id,
      current.roles.map((role) => role.id),
    );
  }

  /** 整批取代持有的角色；與指派給人相同的反提權，另加「持有 super-admin 的帳號只有 super-admin 能改」。 */
  async replaceRoles(
    id: string,
    dto: ReplaceServiceAccountRolesDto,
    actor: AuthUser,
  ): Promise<{ roles: ServiceAccountRoleSummary[] }> {
    const account = await this.getExisting(id);
    await this.assertCanManage(actor, id);
    await this.permissions.assertRolesAssignable(actor.id, dto.roleIds);
    const roles = await this.assertRolesExist(dto.roleIds);

    const before = await withTransaction(this.db, async (tx) => {
      await this.repo.lockForUpdate(id, tx);
      const current = await this.repo.listRoles(id, tx);
      if (!sameIds(current, dto.expectedRoleIds)) {
        throw new AppException('SERVICE_ACCOUNT_ROLES_CONFLICT', {
          currentRoleIds: current.map((role) => role.id),
        });
      }
      await this.repo.replaceRoles(id, dto.roleIds, actor.id, tx);
      await this.audit.record(
        {
          action: 'serviceAccount.assignRole',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: id,
          resourceName: account.displayName,
          changes: {
            before: { roles: current.map((role) => role.slug) },
            after: { roles: roles.map((role) => role.slug) },
          },
        },
        tx,
      );
      return current;
    });

    await this.permissions.permissionsChanged([id]);
    this.publish(ChangeKind.UPDATE, id, [
      ...new Set([...before.map((role) => role.id), ...dto.roleIds]),
    ]);
    return { roles: await this.repo.listRoles(id) };
  }

  // ── 它的 API token（`serviceAccount:update`；讀取用 `serviceAccount:read`） ──

  async listTokens(id: string): Promise<{ items: ApiTokenDto[] }> {
    const account = await this.tokens.requireAccount(id, 'service', 'SERVICE_ACCOUNT_NOT_FOUND');
    return { items: await this.tokens.list(account) };
  }

  /** 反提權由 `ApiTokenService` 檢查：token 取得的有效權限必須是操作者持有的（D4）。 */
  async createToken(
    id: string,
    dto: CreateApiTokenDto,
    actor: AuthUser,
  ): Promise<CreatedApiTokenDto> {
    await this.assertCanManage(actor, id);
    const account = await this.tokens.requireAccount(id, 'service', 'SERVICE_ACCOUNT_NOT_FOUND');
    return this.tokens.create(account, dto, actor);
  }

  async revokeToken(id: string, tokenId: string, actor: AuthUser): Promise<void> {
    const account = await this.tokens.requireAccount(id, 'service', 'SERVICE_ACCOUNT_NOT_FOUND');
    await this.tokens.revoke(account, tokenId, actor);
  }

  private async getExisting(id: string): Promise<ServiceAccountRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('SERVICE_ACCOUNT_NOT_FOUND');
    return row;
  }

  private async assertRolesExist(
    roleIds: readonly string[],
  ): Promise<{ id: string; slug: string }[]> {
    if (!roleIds.length) return [];
    const found = await this.repo.findActiveRolesByIds(roleIds);
    if (found.length !== new Set(roleIds).size) throw new AppException('ROLE_NOT_FOUND');
    return found;
  }

  /**
   * 持有 super-admin 的服務帳號只有 super-admin 能停用、刪除、改角色、替它建 token
   * （與使用者相同，docs/architecture/backend/05-rbac.md §4.1）。
   */
  private async assertCanManage(actor: AuthUser, id: string): Promise<void> {
    if (!(await this.repo.hasRoleSlug(id, SUPER_ADMIN_SLUG))) return;
    if ((await this.permissions.getPermissionSet(actor.id)).isSuperAdmin) return;
    throw new AppException('AUTHZ_ESCALATION', { role: SUPER_ADMIN_SLUG, target: id });
  }

  /**
   * 服務帳號的列表與詳情；`roleIds` 是持有者變動的角色（角色頁的持有者人數與清單）。
   * 服務帳號本身沒有連線，不必帶 `affectedUserIds`。
   */
  private publish(kind: ChangeKind, id: string, roleIds: readonly string[] = []): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.SERVICE_ACCOUNT, kind, id },
        ...roleIds.map((roleId) => ({
          resource: ChangeSource.ROLE,
          kind: ChangeKind.UPDATE,
          id: roleId,
        })),
      ],
    });
  }
}
