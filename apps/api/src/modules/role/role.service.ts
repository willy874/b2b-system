import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import type { RoleRow } from '@/db/schema';
import { isPermissionKey } from '@/db/seeds/permissions';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';
import type {
  EffectivePermission,
  PermissionCatalogItem,
} from '@/modules/permission/permission.service';
import type { ListRevisionDto } from '@/modules/revision/dto/revision.dto';
import { RevisionService } from '@/modules/revision/revision.service';

import type { CreateRoleDto, DuplicateRoleDto } from './dto/create-role.dto';
import type { DeleteRoleDto, ListRoleDto, ListRoleUsersDto } from './dto/list-role.dto';
import type { RevertRoleRevisionDto, RoleRevisionDto } from './dto/role-revision.dto';
import type { RestoredRoleDto, RoleDto } from './dto/role.dto';
import type { UpdateRoleDto, UpdateRolePermissionsDto } from './dto/update-role.dto';
import { RoleRevisionSnapshotSchema, toRoleRevision } from './role-revision';
import type { RoleRevisionSnapshot } from './role-revision';
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
    version: role.version,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

/** `GET /roles/:id/permissions` 的回應（RolePermissionsSchema）。 */
export interface RolePermissions {
  permissions: PermissionCatalogItem[];
  effective: EffectivePermission[];
  isSuperAdmin: boolean;
}

@Injectable()
export class RoleService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: RoleRepository,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly revisions: RevisionService,
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

  async listPermissions(id: string): Promise<RolePermissions> {
    const role = await this.getExisting(id);
    return this.describePermissions(role.id, role.slug === SUPER_ADMIN_SLUG);
  }

  /** 明確授予的權限 ＋ 依賴樹展開後實際持有的鍵（技能樹的「已包含（由 …）」，docs/rbac/02-permission-catalog.md §9）。 */
  private async describePermissions(id: string, isSuperAdmin: boolean): Promise<RolePermissions> {
    const rows = await this.repo.listPermissions(id);
    return {
      permissions: this.permissionService.withDependencies(rows),
      effective: this.permissionService.describeRolePermissions(
        rows.map((row) => row.key as PermissionKey),
        isSuperAdmin,
      ),
      isSuperAdmin,
    };
  }

  async listUsers(id: string, query: ListRoleUsersDto) {
    await this.getExisting(id);
    const { items, total } = await this.repo.listUsers(id, query.offset, query.limit);
    return paginated(items, total, query);
  }

  async create(dto: CreateRoleDto, actor: AuthUser): Promise<RoleDto> {
    await this.assertNameAvailable(dto.name);
    await this.permissionService.assertGrantable(actor.id, dto.permissionKeys as PermissionKey[]);
    await this.permissionService.assertKeysExist(dto.permissionKeys);

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
      await this.repo.addPermissions(created.id, dto.permissionKeys, actor.id, tx);
      await this.recordRevision(created, actor.id, tx);
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
    const { version, ...fields } = dto;
    const role = await this.getExisting(id);
    // 讀到時就不同：別人已經改過（docs/architecture/backend/14-revisions.md §9.2 D3）
    if (version !== role.version) {
      throw new AppException('ROLE_VERSION_CONFLICT', { current: role.version });
    }
    // super-admin 的名稱與說明也不可改；其他系統角色的顯示名稱可改（docs/rbac/01-domain-model.md §5）
    if (role.slug === SUPER_ADMIN_SLUG) throw new AppException('ROLE_SUPER_ADMIN_IMMUTABLE');
    // 只改大小寫（`admin` → `Admin`）不算撞名：唯一性不分大小寫，撞到的是自己
    if (dto.name && dto.name.toLowerCase() !== role.name.toLowerCase()) {
      await this.assertNameAvailable(dto.name);
    }

    const changes = diff(role, fields, [...ROLE_AUDIT_FIELDS]);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, { ...fields, updatedBy: actor.id }, version, tx);
      // 讀到之後、寫入之前被別人改過（版本變了）或刪除
      if (!updated) throw await this.missedUpdate(id, tx);
      // UPDATE 已經鎖住角色列：同一個角色的版本號依序產生
      await this.recordRevision(updated, actor.id, tx);
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
  ): Promise<RolePermissions> {
    const role = await this.getExisting(id);
    if (role.slug === SUPER_ADMIN_SLUG) throw new AppException('ROLE_SUPER_ADMIN_IMMUTABLE');

    const touched = [...dto.add, ...dto.remove];
    await this.permissionService.assertKeysExist(touched);
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
      // 鎖住角色列：同一個角色的權限變更依序進行，before／after 與版本號不會被併發的另一筆交錯
      const locked = await this.repo.lockActiveRow(id, tx);
      if (!locked) throw new AppException('ROLE_NOT_FOUND');
      const before = await this.repo.listPermissionKeys(id, tx);
      if (dto.remove.length) {
        await this.repo.removePermissions(id, dto.remove, tx);
      }
      if (dto.add.length) {
        await this.repo.addPermissions(id, dto.add, actor.id, tx);
      }
      const after = await this.repo.listPermissionKeys(id, tx);
      // 權限鍵是關聯的寫入，不遞增角色的 `version`（docs/architecture/backend/14-revisions.md §9.2 D3），但會產生新的一版
      await this.revisions.record(tx, {
        resourceType: RESOURCE_TYPE.ROLE,
        resourceId: id,
        snapshot: toRoleRevision(locked, after),
        actorId: actor.id,
      });
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

    // ★ 快取失效在交易「之後」——交易可能 rollback；推播的 room 同步在失效之後。
    // 持有者不是失效的依據（整個租戶都失效）：給剛取得檔案權限的人補建個人資料夾、讓他們的畫面重抓
    const holders = await this.permissionService.findUserIdsByRole(id);
    await this.permissionService.permissionsChanged(holders);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE_PERMISSION, kind: ChangeKind.UPDATE, id }],
      affectedUserIds: holders,
    });
    return this.describePermissions(id, false);
  }

  async duplicate(id: string, dto: DuplicateRoleDto, actor: AuthUser) {
    const source = await this.getExisting(id);
    const name = dto.name ?? (await this.uniqueName(`${source.name} Copy`));
    await this.assertNameAvailable(name);

    const sourceKeys = (await this.repo.listPermissionKeys(id)) as PermissionKey[];
    const { granted, skipped } = await this.permissionService.filterGrantable(actor.id, sourceKeys);
    await this.permissionService.assertKeysExist(granted);

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
      await this.repo.addPermissions(role.id, granted, actor.id, tx);
      await this.recordRevision(role, actor.id, tx);
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
      // 持有者邊保留（還原時原本的持有者自動回來，docs/architecture/backend/14-revisions.md §9.2 D2）；持有者在刪除前查出，只用來推播讓他們的畫面重抓
      const holders = await this.repo.findHolderIds(id, tx);
      await this.repo.softDelete(id, actor.id, tx);
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

    await this.permissionService.permissionsChanged();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ROLE, kind: ChangeKind.DELETE, id }],
      affectedUserIds: affected,
    });
  }

  /**
   * 還原刪除的角色（docs/architecture/backend/14-revisions.md §9.2 D2、D5、D10）：清 `deleted_at`。刪除時保留的持有者邊、權限鍵、資料夾授權隨之生效，
   * 原本的持有者（仍存在的使用者）自動拿回這個角色。R3 之前刪除的角色已經沒有持有者邊，`holdersRestored` 是 0。
   *
   * 反提權：還原等於「把這個角色（連同它的權限鍵）重新交給每一位原本的持有者」，所以與指派角色同一個檢查
   * （`assertRolesAssignable`：角色帶的鍵都要是 actor 持有的；super-admin 另外特判，但系統角色刪不掉，不會走到）。
   * 只檢查權限鍵（`assertGrantable`）不夠嚴格的地方只有 super-admin，兩者在這裡等價；用指派的檢查是讓規則的
   * 語意與實際效果（持有者重新生效）一致，之後若角色能帶其他關係也不會漏。
   */
  async restore(id: string, actor: AuthUser): Promise<RestoredRoleDto> {
    const role = await this.repo.findDeletedById(id);
    if (!role) {
      throw new AppException(
        (await this.repo.findById(id)) ? 'ROLE_NOT_DELETED' : 'ROLE_NOT_FOUND',
      );
    }
    await this.assertRestorable(role);
    await this.permissionService.assertRolesAssignable(actor.id, [id]);

    const holdersRestored = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('ROLE_NOT_DELETED');
      // 休眠的持有者邊中仍存在的使用者：還原之後就是這個角色的持有者（與 userCount 同一個計數）
      const restoredHolders = await this.repo.countUsers(id, tx);
      await this.audit.record(
        {
          action: 'role.restore',
          resourceType: RESOURCE_TYPE.ROLE,
          resourceId: id,
          resourceName: row.name,
          changes: { after: { name: row.name, slug: row.slug } },
          metadata: { deletedAt: role.deletedAt?.toISOString(), holdersRestored: restoredHolders },
        },
        tx,
      );
      return restoredHolders;
    });

    // ★ 交易之後：權限快取失效（持有者重新拿到角色的權限鍵）→ 推播。持有者只用來補建個人資料夾與推播
    const holders = await this.permissionService.findUserIdsByRole(id);
    await this.permissionService.permissionsChanged(holders);
    // 重新出現在列表：以 create 宣告（與使用者的還原相同；回收桶由前端的依賴圖跟著失效）。
    // 每位持有者的角色也變了：以 userRole update 宣告，他們的使用者詳情與本人的 profile 才會重抓
    // （還原的角色不在他們的 profile 裡，前端無法從 role 的變更判斷自己是不是持有者）
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.ROLE, kind: ChangeKind.CREATE, id },
        ...holders.map((userId) => ({
          resource: ChangeSource.USER_ROLE,
          kind: ChangeKind.UPDATE,
          id: userId,
          refs: { [ChangeSource.ROLE]: [id] },
        })),
      ],
      affectedUserIds: holders,
    });
    return { ...(await this.findOne(id)), holdersRestored };
  }

  // ── 版本歷史（docs/architecture/backend/14-revisions.md §4、docs/architecture/backend/14-revisions.md §9.2 D1、D10） ──

  /** 角色的版本，新的在前。看版本＝看得到角色（`role:read`）；已刪除的角色 404。 */
  async listRevisions(id: string, query: ListRevisionDto) {
    await this.getExisting(id);
    return this.revisions.list(RESOURCE_TYPE.ROLE, id, query);
  }

  async getRevision(id: string, version: number): Promise<RoleRevisionDto> {
    await this.getExisting(id);
    const revision = await this.revisions.get(RESOURCE_TYPE.ROLE, id, version);
    const parsed = RoleRevisionSnapshotSchema.safeParse(revision.snapshot);
    // 形狀對不上（白名單之後改過）的舊版本當成沒有內容，與過大未保存相同
    return { ...revision, snapshot: parsed.success ? parsed.data : null };
  }

  /**
   * 還原到某一版（docs/architecture/backend/14-revisions.md §9.2 D1、D10）：把那一版的快照當成一次新的更新——名稱、說明照一般的 `PATCH /roles/:id`
   * （`version` + 1、樂觀鎖、名稱唯一），權限鍵照 `PATCH /roles/:id/permissions`（反提權、自我鎖定），寫入之後產生新的一版，
   * 歷史不改寫。稽核記 `role.update`，`metadata.revertedFrom` 帶來源版本。
   *
   * 權限：路由要 `role:update`；權限鍵會改變時另外要 `role:grantPermission`（與改權限的端點相同，
   * 否則沒有授權權限的人能藉還原拿掉角色的鍵）。加回的鍵要是 actor 持有的（`assertGrantable`）。
   * 目錄裡已經不存在的鍵略過（`metadata.skippedPermissions`），不讓舊版本因為目錄改過而無法還原。
   */
  async revertToRevision(
    id: string,
    version: number,
    dto: RevertRoleRevisionDto,
    actor: AuthUser,
  ): Promise<RoleDto> {
    const role = await this.getExisting(id);
    if (dto.version !== role.version) {
      throw new AppException('ROLE_VERSION_CONFLICT', { current: role.version });
    }
    if (role.slug === SUPER_ADMIN_SLUG) throw new AppException('ROLE_SUPER_ADMIN_IMMUTABLE');
    const target = await this.snapshotOf(id, version);
    const targetKeys = target.permissionKeys.filter(isPermissionKey);
    const targetSet = new Set<string>(targetKeys);
    const skippedPermissions = target.permissionKeys.filter((key) => !isPermissionKey(key));
    if (target.name.toLowerCase() !== role.name.toLowerCase()) {
      await this.assertNameAvailable(target.name);
    }

    const keysChanged = await withTransaction(this.db, async (tx) => {
      // 鎖住角色列之後才算權限鍵的差異與做反提權的檢查：交易外讀到的集合可能已被別人改過
      const locked = await this.repo.lockActiveRow(id, tx);
      if (!locked) throw new AppException('ROLE_NOT_FOUND');
      const before = await this.repo.listPermissionKeys(id, tx);
      const add = targetKeys.filter((key) => !before.includes(key));
      const remove = before.filter((key) => !targetSet.has(key));
      const changesKeys = add.length > 0 || remove.length > 0;
      if (changesKeys) {
        await this.assertCanGrantPermissions(actor, id);
        await this.permissionService.assertGrantable(actor.id, add);
        await this.permissionService.assertNoSelfLockout(
          actor.id,
          id,
          targetKeys,
          ROLE_MANAGEMENT_PERMISSIONS,
        );
      }

      const fields = { name: target.name, description: target.description };
      const updated = await this.repo.update(
        id,
        { ...fields, updatedBy: actor.id },
        dto.version,
        tx,
      );
      if (!updated) throw await this.missedUpdate(id, tx);
      await this.repo.removePermissions(id, remove, tx);
      await this.repo.addPermissions(id, add, actor.id, tx);
      const after = await this.repo.listPermissionKeys(id, tx);

      const fieldChanges = diff(locked, fields, [...ROLE_AUDIT_FIELDS]);
      await this.audit.record(
        {
          action: 'role.update',
          resourceType: RESOURCE_TYPE.ROLE,
          resourceId: id,
          resourceName: updated.name,
          changes: {
            before: { ...fieldChanges?.before, ...(changesKeys && { permissions: before }) },
            after: { ...fieldChanges?.after, ...(changesKeys && { permissions: after }) },
          },
          metadata: {
            revertedFrom: version,
            ...(skippedPermissions.length > 0 && { skippedPermissions }),
          },
        },
        tx,
      );
      await this.revisions.record(tx, {
        resourceType: RESOURCE_TYPE.ROLE,
        resourceId: id,
        snapshot: toRoleRevision(updated, after),
        actorId: actor.id,
      });
      return changesKeys;
    });

    // ★ 交易之後：權限快取失效（改了權限鍵時）→ 推播；與 update／updatePermissions 相同的順序
    const holders = await this.permissionService.findUserIdsByRole(id);
    if (keysChanged) await this.permissionService.permissionsChanged(holders);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id },
        ...(keysChanged
          ? [{ resource: ChangeSource.ROLE_PERMISSION, kind: ChangeKind.UPDATE, id }]
          : []),
      ],
      affectedUserIds: holders,
    });
    return this.findOne(id);
  }

  /** 還原用的快照：過大未保存 → 409 `REVISION_UNAVAILABLE`；形狀對不上（白名單之後改過）同樣無法還原。 */
  private async snapshotOf(id: string, version: number): Promise<RoleRevisionSnapshot> {
    const snapshot = await this.revisions.getSnapshot(RESOURCE_TYPE.ROLE, id, version);
    const parsed = RoleRevisionSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new AppException('REVISION_UNAVAILABLE', { version, reason: 'incompatible' });
    }
    return parsed.data;
  }

  /**
   * 還原會改變權限鍵時，另外要有 `role:grantPermission`（與 `PATCH /roles/:id/permissions` 的路由宣告相同）。
   * 拒絕照 `PermissionsGuard` 的形狀：`403 AUTHZ_FORBIDDEN` ＋ `authz.denied` 稽核。
   */
  private async assertCanGrantPermissions(actor: AuthUser, roleId: string): Promise<void> {
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(actor.id);
    if (isSuperAdmin || permissions.has(PERMISSION.ROLE_GRANT_PERMISSION)) return;
    const required = [PERMISSION.ROLE_GRANT_PERMISSION];
    await this.audit.recordSafely({
      action: 'authz.denied',
      result: 'failure',
      actorId: actor.id,
      actorEmail: actor.email,
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: {
        route: 'POST /roles/:id/revisions/:version/revert',
        roleId,
        required,
        missing: required,
      },
    });
    throw new AppException('AUTHZ_FORBIDDEN', { required, missing: required });
  }

  /** 寫入之後的狀態存成一版（在呼叫端的交易內，角色列已被鎖住或剛建立）。 */
  private async recordRevision(
    role: Pick<RoleRow, 'id' | 'name' | 'description'>,
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    const keys = await this.repo.listPermissionKeys(role.id, tx);
    await this.revisions.record(tx, {
      resourceType: RESOURCE_TYPE.ROLE,
      resourceId: role.id,
      snapshot: toRoleRevision(role, keys),
      actorId,
    });
  }

  // ── 業務規則 ─────────────────────────────────────────────

  /**
   * 還原前的唯一值檢查（docs/architecture/backend/14-revisions.md §9.2 D5）：名稱或 slug 已被 **未刪除** 的角色使用 → `409 ROLE_NAME_DUPLICATE`，
   * `details.conflictingRoleId` 帶佔用者，前端直接連過去。slug 建立後不可變，撞 slug 時只能先處理佔用的角色；
   * 撞名稱時也可以先把佔用的角色改名。檢查與寫入之間的競態由 partial unique index 擋下（同一個錯誤碼，不帶佔用者）。
   */
  private async assertRestorable(role: RoleRow): Promise<void> {
    const nameTaken = await this.repo.findByName(role.name);
    if (nameTaken) {
      throw new AppException('ROLE_NAME_DUPLICATE', {
        field: 'name',
        value: role.name,
        conflictingRoleId: nameTaken.id,
      });
    }
    const slugTaken = await this.repo.findBySlug(role.slug);
    if (slugTaken) {
      throw new AppException('ROLE_NAME_DUPLICATE', {
        field: 'slug',
        value: role.slug,
        conflictingRoleId: slugTaken.id,
      });
    }
  }

  /**
   * 條件式 UPDATE 沒有命中：列已不在 → 404；還在就是版本被搶先改過 → 409 並帶重讀的目前版本
   * （docs/architecture/backend/14-revisions.md §9.2 D3）。
   */
  private async missedUpdate(id: string, tx: DbOrTx): Promise<AppException> {
    const current = await this.repo.findVersion(id, tx);
    return current === undefined
      ? new AppException('ROLE_NOT_FOUND')
      : new AppException('ROLE_VERSION_CONFLICT', { current });
  }

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
