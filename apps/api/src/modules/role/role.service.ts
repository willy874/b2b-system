import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
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
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: RoleRepository,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
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

    return this.findOne(role.id);
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuthUser): Promise<RoleDto> {
    const role = await this.getExisting(id);
    if (dto.name && dto.name !== role.name) await this.assertNameAvailable(dto.name);

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

    const before = await this.repo.listPermissionKeys(id);
    const after = [...new Set([...before, ...dto.add])].filter(
      (key) => !dto.remove.includes(key as PermissionKey),
    );

    await withTransaction(this.db, async (tx) => {
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

    // ★ 快取失效在交易「之後」——交易可能 rollback
    await this.permissionService.invalidateByRole(id);
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

    return { ...(await this.findOne(created.id)), skippedPermissions: skipped };
  }

  async remove(id: string, query: DeleteRoleDto, actor: AuthUser): Promise<void> {
    const role = await this.getExisting(id);
    if (role.isSystem) throw new AppException('ROLE_SYSTEM_PROTECTED');

    const userCount = await this.repo.countUsers(id);
    if (userCount > 0 && !query.force) {
      throw new AppException('ROLE_IN_USE', { userCount });
    }

    // ★ 順序陷阱：先查出受影響的使用者，再刪角色
    const affected = await this.repo.findUserIdsByRole(id);

    await withTransaction(this.db, async (tx) => {
      await this.repo.softDelete(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'role.delete',
          resourceType: 'role',
          resourceId: id,
          resourceName: role.name,
          changes: { before: { name: role.name, slug: role.slug } },
          metadata: { forced: query.force === true, userCount },
        },
        tx,
      );
    });

    this.permissionService.invalidateUsers(affected);
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
    const existing = new Set((await this.repo.searchByName(base)).map((role) => role.name));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base} ${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new AppException('ROLE_NAME_DUPLICATE', { field: 'name' });
  }
}
