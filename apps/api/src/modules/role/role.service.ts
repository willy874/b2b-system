import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { PermissionRow } from '@/db/schema';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import type { CreateRoleDto, DuplicateRoleDto } from './dto/create-role.dto';
import type { DeleteRoleDto, ListRoleDto, ListRoleUsersDto } from './dto/list-role.dto';
import type { RoleDto } from './dto/role.dto';
import type { UpdateRoleDto, UpdateRolePermissionsDto } from './dto/update-role.dto';
import { ROLE_AUDIT_FIELDS, slugify } from './role.constants';
import type { RoleWithCounts } from './role.repository';
import { RoleRepository } from './role.repository';

/**
 * 管理角色所需的權限：管理者改自己持有的角色時不能把這些拿掉，否則連自己在內都改不回來
 * （docs/architecture/backend/05-rbac.md §8.4）。
 */
const ROLE_MANAGEMENT_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSION.ROLE_READ,
  PERMISSION.ROLE_UPDATE,
  PERMISSION.ROLE_GRANT_PERMISSION,
];

function toDto(role: RoleWithCounts): RoleDto {
  return {
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionCount: role.permissionCount,
    userCount: role.userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

@Injectable()
export class RoleService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: RoleRepository,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: ListRoleDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
  }

  async findOne(id: string): Promise<RoleDto> {
    const role = await this.repo.withCounts(id);
    if (!role) throw new AppException('ROLE_NOT_FOUND');
    return toDto(role);
  }

  async listPermissions(id: string): Promise<{ permissions: PermissionRow[] }> {
    await this.getExisting(id);
    return { permissions: await this.repo.listPermissions(id) };
  }

  async listUsers(id: string, query: ListRoleUsersDto) {
    await this.getExisting(id);
    const { items, total } = await this.repo.listUsers(id, query.offset, query.limit);
    return paginated(items, total, query);
  }

  async create(dto: CreateRoleDto, actor: AuthUser): Promise<RoleDto> {
    await this.assertNameAvailable(dto.name);
    await this.permissionService.assertGrantable(actor.id, dto.permissionKeys as PermissionKey[]);
    const permissionIds = await this.permissionService.assertKeysExist(dto.permissionKeys);

    const role = await withTransaction(this.db, async (tx) => {
      const created = await this.repo.create(
        {
          slug: await this.uniqueSlug(slugify(dto.name)),
          name: dto.name,
          description: dto.description ?? null,
          isSystem: false,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.repo.addPermissions(created.id, [...permissionIds.values()], actor.id, tx);
      await this.audit.record(
        {
          action: 'role.create',
          resourceType: 'role',
          resourceId: created.id,
          resourceName: created.name,
          changes: { after: { name: created.name, permissions: dto.permissionKeys } },
        },
        tx,
      );
      return created;
    });

    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE, kind: ChangeKind.CREATE, id: role.id }],
    });
    return this.findOne(role.id);
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuthUser): Promise<RoleDto> {
    const role = await this.getExisting(id);
    // super-admin 的名稱與說明也不可改；其他系統角色的顯示名稱可改（docs/rbac/01-domain-model.md §5）
    if (role.slug === SUPER_ADMIN_SLUG) throw new AppException('ROLE_SUPER_ADMIN_IMMUTABLE');
    // 只改大小寫（`admin` → `Admin`）不算撞名：唯一性不分大小寫，撞到的是自己
    if (dto.name && dto.name.toLowerCase() !== role.name.toLowerCase()) {
      await this.assertNameAvailable(dto.name);
    }

    const changes = diff(role, dto, [...ROLE_AUDIT_FIELDS]);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, { ...dto, updatedBy: actor.id }, tx);
      if (!updated) throw new AppException('ROLE_NOT_FOUND');
      await this.audit.record(
        {
          action: 'role.update',
          resourceType: 'role',
          resourceId: id,
          resourceName: updated.name,
          changes,
        },
        tx,
      );
    });

    // 改名不影響權限，但持有者的 profile（角色名稱）要重抓
    const holders = await this.permissionService.findUserIdsByRole(id);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id }],
      affectedUserIds: holders,
    });
    return this.findOne(id);
  }

  async updatePermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
    actor: AuthUser,
  ): Promise<{ permissions: PermissionRow[] }> {
    const role = await this.getExisting(id);
    if (role.slug === SUPER_ADMIN_SLUG) throw new AppException('ROLE_SUPER_ADMIN_IMMUTABLE');

    const touched = [...dto.add, ...dto.remove];
    const ids = await this.permissionService.assertKeysExist(touched);
    await this.permissionService.assertGrantable(actor.id, dto.add as PermissionKey[]);

    // 自我鎖定的預估用交易外的讀取；稽核的 before／after 在交易內讀，才是實際寫入的前後
    const predicted = [
      ...new Set([...(await this.repo.listPermissionKeys(id)), ...dto.add]),
    ].filter((key) => !dto.remove.includes(key as PermissionKey));
    await this.permissionService.assertNoSelfLockout(
      actor.id,
      id,
      predicted,
      ROLE_MANAGEMENT_PERMISSIONS,
    );

    await withTransaction(this.db, async (tx) => {
      // 鎖住角色列：同一個角色的權限變更依序進行，before／after 不會被併發的另一筆交錯
      if (!(await this.repo.lockActive(id, tx))) throw new AppException('ROLE_NOT_FOUND');
      const before = await this.repo.listPermissionKeys(id, tx);
      if (dto.remove.length) {
        await this.repo.removePermissions(
          id,
          dto.remove.map((key) => ids.get(key)!),
          tx,
        );
      }
      if (dto.add.length) {
        await this.repo.addPermissions(
          id,
          dto.add.map((key) => ids.get(key)!),
          actor.id,
          tx,
        );
      }
      const after = await this.repo.listPermissionKeys(id, tx);
      await this.audit.record(
        {
          action: 'role.grantPermission',
          resourceType: 'role',
          resourceId: id,
          resourceName: role.name,
          changes: { before: { permissions: before }, after: { permissions: after } },
        },
        tx,
      );
    });

    // ★ 快取失效在交易「之後」——交易可能 rollback；之後才發事件（room 同步要讀到新權限）
    const holders = await this.permissionService.findUserIdsByRole(id);
    this.permissionService.invalidateUsers(holders);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: holders });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE_PERMISSION, kind: ChangeKind.UPDATE, id }],
      affectedUserIds: holders,
    });
    return { permissions: await this.repo.listPermissions(id) };
  }

  async duplicate(id: string, dto: DuplicateRoleDto, actor: AuthUser) {
    const source = await this.getExisting(id);
    const name = dto.name ?? (await this.uniqueName(`${source.name} Copy`));
    await this.assertNameAvailable(name);

    const sourceKeys = (await this.repo.listPermissionKeys(id)) as PermissionKey[];
    const { granted, skipped } = await this.permissionService.filterGrantable(actor.id, sourceKeys);
    const permissionIds = await this.permissionService.assertKeysExist(granted);

    const created = await withTransaction(this.db, async (tx) => {
      const role = await this.repo.create(
        {
          slug: await this.uniqueSlug(slugify(name)),
          name,
          description: source.description,
          isSystem: false,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.repo.addPermissions(role.id, [...permissionIds.values()], actor.id, tx);
      await this.audit.record(
        {
          action: 'role.duplicate',
          resourceType: 'role',
          resourceId: role.id,
          resourceName: role.name,
          changes: { after: { source: source.slug, permissions: granted } },
          metadata: { skippedPermissions: skipped },
        },
        tx,
      );
      return role;
    });

    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE, kind: ChangeKind.CREATE, id: created.id }],
    });
    return { ...(await this.findOne(created.id)), skippedPermissions: skipped };
  }

  async remove(id: string, query: DeleteRoleDto, actor: AuthUser): Promise<void> {
    const role = await this.getExisting(id);
    if (role.isSystem) throw new AppException('ROLE_SYSTEM_PROTECTED');

    await this.permissionService.assertNoSelfLockout(actor.id, id, [], ROLE_MANAGEMENT_PERMISSIONS);

    const affected = await withTransaction(this.db, async (tx) => {
      // 鎖住角色列再計數：併發的指派（`FOR SHARE`）會先提交、
      // 被算進來；或是等這裡提交後看到角色已刪除而不插入。
      if (!(await this.repo.lockActive(id, tx))) throw new AppException('ROLE_NOT_FOUND');
      const count = await this.repo.countUsers(id, tx);
      if (count > 0 && !query.force) {
        throw new AppException('ROLE_IN_USE', { userCount: count });
      }
      // ★ 受影響的使用者由刪除指派的同一條語句（`RETURNING`）取得：不會漏掉、也不會在刪除後才查而查不到
      const holders = await this.repo.softDelete(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'role.delete',
          resourceType: 'role',
          resourceId: id,
          resourceName: role.name,
          changes: { before: { name: role.name, slug: role.slug } },
          metadata: { forced: query.force === true, userCount: count },
        },
        tx,
      );
      return holders;
    });

    this.permissionService.invalidateUsers(affected);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: affected });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE, kind: ChangeKind.DELETE, id }],
      affectedUserIds: affected,
    });
  }

  // ── 業務規則 ─────────────────────────────────────────────

  private async getExisting(id: string) {
    const role = await this.repo.findById(id);
    if (!role) throw new AppException('ROLE_NOT_FOUND');
    return role;
  }

  private async assertNameAvailable(name: string): Promise<void> {
    if (await this.repo.findByName(name)) {
      throw new AppException('ROLE_NAME_DUPLICATE', { field: 'name', value: name });
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    const existing = new Set(await this.repo.findSlugsLike(base));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new AppException('ROLE_NAME_DUPLICATE', { field: 'name' });
  }

  private async uniqueName(base: string): Promise<string> {
    // 名稱唯一性不分大小寫：比對也用小寫
    const existing = new Set(
      (await this.repo.searchByName(base)).map((role) => role.name.toLowerCase()),
    );
    if (!existing.has(base.toLowerCase())) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base} ${index}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    throw new AppException('ROLE_NAME_DUPLICATE', { field: 'name' });
  }
}
