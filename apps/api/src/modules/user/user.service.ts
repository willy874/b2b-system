import { ChangeKind, ChangeSource, SessionRevokedReason } from '@game-editor/realtime';
import type { ResourceChangeWire } from '@game-editor/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { runBatch } from '@/core/batch';
import type { BatchResult } from '@/core/batch';
import { UserCacheService } from '@/core/cache';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { AuditMetadata, UserInsert, UserRow, UserStatus } from '@/db/schema';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { AuthTokenService } from '@/modules/auth/auth-token.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import type { BatchUserStatus } from './dto/batch-user.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { ListUserDto } from './dto/list-user.dto';
import type { ReplaceUserRolesDto, UpdateUserDto } from './dto/update-user.dto';
import type { UserDto } from './dto/user.dto';
import { USER_AUDIT_FIELDS } from './user.constants';
import type { UserRoleSummary, UserWithRoles } from './user.repository';
import { UserRepository } from './user.repository';

/** `createAccount()` 的輸入：`passwordHash` 為 null 時帳號必須走啟用信流程（status = pending）。 */
export interface NewAccount {
  email: string;
  username?: string | null;
  displayName: string;
  passwordHash?: string | null;
  status: UserStatus;
  roleIds: readonly string[];
}

/** 單筆與批次共用的操作對象：交易前查好，交易與事件都用同一份。 */
interface UserTarget {
  user: UserRow;
  roles: UserRoleSummary[];
}

function toDto(user: UserRow, roles: UserRoleSummary[]): UserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    roles,
    locale: user.locale,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** 使用者資料或狀態變更；帶上持有的角色，讓角色的持有者清單精準失效。 */
export function userUpdated(
  id: string,
  roles: readonly Pick<UserRoleSummary, 'id'>[],
): ResourceChangeWire {
  return {
    resource: ChangeSource.USER,
    kind: ChangeKind.UPDATE,
    id,
    refs: { [ChangeSource.ROLE]: roles.map((role) => role.id) },
  };
}

@Injectable()
export class UserService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: UserRepository,
    private readonly permissionService: PermissionService,
    private readonly authTokens: AuthTokenService,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: ListUserDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(
      items.map((item: UserWithRoles) => toDto(item, item.roles)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.repo.findByIdWithRoles(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return toDto(user, user.roles);
  }

  async listRoles(id: string): Promise<{ roles: UserRoleSummary[] }> {
    await this.getExisting(id);
    return { roles: await this.repo.listRoles(id) };
  }

  async listPermissions(id: string): Promise<{ permissions: string[] }> {
    await this.getExisting(id);
    return { permissions: await this.permissionService.getEffectivePermissionKeys(id) };
  }

  async create(dto: CreateUserDto, actor: AuthUser): Promise<UserDto> {
    await this.assertCreatable(dto.email, dto.roleIds, actor);

    const created = await withTransaction(this.db, (tx) =>
      this.createAccount(
        {
          email: dto.email,
          username: dto.username ?? null,
          displayName: dto.displayName,
          status: 'pending', // 不接受 password：一律走啟用信流程
          roleIds: dto.roleIds,
        },
        actor,
        tx,
      ),
    );

    await this.authTokens.issue(created.id, 'activation');
    this.publishCreated(created.id, dto.roleIds);
    return toDto(created, await this.repo.listRoles(created.id));
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserDto> {
    const user = await this.getExisting(id);

    if (dto.status && dto.status !== user.status) {
      await this.assertStatusChangeAllowed(id, dto.status, actor);
    }
    if (dto.username && dto.username !== user.username) {
      await this.assertUsernameAvailable(dto.username);
    }

    const changes = diff(user, dto, [...USER_AUDIT_FIELDS]);
    const deactivating = dto.status !== undefined && dto.status !== 'active';

    const updated = await withTransaction(this.db, async (tx) => {
      const next = await this.repo.update(id, { ...dto, updatedBy: actor.id }, tx);
      if (!next) throw new AppException('USER_NOT_FOUND');

      if (deactivating) await this.revokeSessions(id, tx);

      await this.audit.record(
        {
          action: 'user.update',
          resourceType: 'user',
          resourceId: id,
          resourceName: next.email,
          changes,
        },
        tx,
      );
      return next;
    });

    this.invalidateAccount(id);

    const roles = await this.repo.listRoles(id);
    if (deactivating) {
      this.events.publish(DomainEvent.SESSIONS_REVOKED, {
        userIds: [id],
        reason: SessionRevokedReason.ACCOUNT_DISABLED,
      });
    }
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(id, roles)],
      affectedUserIds: [id],
    });
    return toDto(updated, roles);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const plan = await this.prepareRemove(id, actor);
    await withTransaction(this.db, (tx) => this.applyRemove(plan, actor, tx));
    this.invalidateAccount(id);
    this.publishRemoved([plan]);
  }

  removeMany(ids: readonly string[], actor: AuthUser): Promise<BatchResult> {
    return runBatch(this.db, ids, {
      prepare: (id) => this.prepareRemove(id, actor),
      apply: (plan, tx) => this.applyRemove(plan, actor, tx),
      invalidate: (plan) => this.invalidateAccount(plan.user.id),
      publish: (plans) => this.publishRemoved(plans),
    });
  }

  /** PUT：整批取代語意。 */
  async replaceRoles(
    id: string,
    dto: ReplaceUserRolesDto,
    actor: AuthUser,
  ): Promise<{ roles: UserRoleSummary[] }> {
    const user = await this.getExisting(id);
    this.assertNotSelf(actor.id, id);
    await this.permissionService.assertRolesAssignable(actor.id, dto.roleIds);
    await this.assertRolesExist(dto.roleIds);

    const before = await this.repo.listRoles(id);
    const roles = await this.repo.findActiveRolesByIds(dto.roleIds);
    const losingSuperAdmin =
      before.some((role) => role.slug === SUPER_ADMIN_SLUG) &&
      !roles.some((role) => role.slug === SUPER_ADMIN_SLUG);
    if (losingSuperAdmin) await this.assertNotLastSuperAdmin(id);

    await withTransaction(this.db, async (tx) => {
      await this.repo.replaceRoles(id, dto.roleIds, actor.id, tx);
      await this.audit.record(
        {
          action: 'user.assignRole',
          resourceType: 'user',
          resourceId: id,
          resourceName: user.email,
          changes: {
            before: { roles: before.map((role) => role.slug) },
            after: { roles: roles.map((role) => role.slug) },
          },
        },
        tx,
      );
    });

    this.permissionService.invalidateUser(id);
    // 新舊角色都要通知：兩邊的 userCount 與持有者清單都變了
    const roleIds = [...new Set([...before.map((role) => role.id), ...dto.roleIds])];
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: [id] });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.USER_ROLE,
          kind: ChangeKind.UPDATE,
          id,
          refs: { [ChangeSource.ROLE]: roleIds },
        },
      ],
      affectedUserIds: [id],
    });
    return { roles: await this.repo.listRoles(id) };
  }

  async resetPassword(id: string, actor: AuthUser): Promise<{ sent: true }> {
    const user = await this.getExisting(id);
    await this.authTokens.issue(id, 'password_reset');
    await this.audit.record({
      action: 'user.reset_password_requested',
      resourceType: 'user',
      resourceId: id,
      resourceName: user.email,
      actorId: actor.id,
      actorEmail: actor.email,
    });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.USER_CREDENTIAL, kind: ChangeKind.UPDATE, id }],
    });
    return { sent: true };
  }

  async unlock(id: string, actor: AuthUser): Promise<UserDto> {
    const plan = await this.prepareUnlock(id);
    const updated = await withTransaction(this.db, (tx) => this.applyUnlock(plan, actor, tx));
    this.userCache.invalidate(id);
    this.publishUpdated([plan]);
    return toDto(updated, plan.roles);
  }

  unlockMany(ids: readonly string[], actor: AuthUser): Promise<BatchResult> {
    return runBatch(this.db, ids, {
      prepare: (id) => this.prepareUnlock(id),
      apply: async (plan, tx) => {
        await this.applyUnlock(plan, actor, tx);
      },
      invalidate: (plan) => this.userCache.invalidate(plan.user.id),
      publish: (plans) => this.publishUpdated(plans),
    });
  }

  /** 批次停用／啟用；已經是目標狀態的算成功、不寫入（ADR-0009 D9）。 */
  updateStatusMany(
    ids: readonly string[],
    status: BatchUserStatus,
    actor: AuthUser,
  ): Promise<BatchResult> {
    return runBatch(this.db, ids, {
      prepare: (id) => this.prepareStatus(id, status, actor),
      apply: (plan, tx) => this.applyStatus(plan, status, actor, tx),
      invalidate: (plan) => this.invalidateAccount(plan.user.id),
      publish: (plans) => {
        if (status !== 'active') {
          this.events.publish(DomainEvent.SESSIONS_REVOKED, {
            userIds: plans.map((plan) => plan.user.id),
            reason: SessionRevokedReason.ACCOUNT_DISABLED,
          });
        }
        this.publishUpdated(plans);
      },
    });
  }

  // ── 單筆與批次共用的步驟：檢查 → 交易內寫入與稽核 → 快取失效；事件由呼叫端在最後發 ──
  // （ADR-0009 §D3／D4）

  private async prepareRemove(id: string, actor: AuthUser): Promise<UserTarget> {
    const user = await this.getExisting(id);
    this.assertNotSelf(actor.id, id);
    await this.assertNotLastSuperAdmin(id);
    // 先查角色再刪：推播要帶上受影響的角色（userCount）
    return { user, roles: await this.repo.listRoles(id) };
  }

  private async applyRemove({ user }: UserTarget, actor: AuthUser, tx: Transaction): Promise<void> {
    await this.repo.softDelete(user.id, actor.id, tx);
    await this.authTokens.revokeAllRefreshTokens(user.id, 'user_disabled', tx);
    await this.audit.record(
      {
        action: 'user.delete',
        resourceType: 'user',
        resourceId: user.id,
        resourceName: user.email,
        changes: { before: { email: user.email, status: user.status } },
      },
      tx,
    );
  }

  private publishRemoved(plans: readonly UserTarget[]): void {
    // softDelete 遞增了 token_version
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      userIds: plans.map((plan) => plan.user.id),
      reason: SessionRevokedReason.TOKEN_INVALID,
    });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: plans.map(({ user, roles }) => ({
        resource: ChangeSource.USER,
        kind: ChangeKind.DELETE,
        id: user.id,
        refs: { [ChangeSource.ROLE]: roles.map((role) => role.id) },
      })),
    });
  }

  private async prepareUnlock(id: string): Promise<UserTarget> {
    const user = await this.getExisting(id);
    const locked = user.status === 'locked' || (user.lockedUntil?.getTime() ?? 0) > Date.now();
    if (!locked) throw new AppException('USER_NOT_LOCKED');
    return { user, roles: await this.repo.listRoles(id) };
  }

  private async applyUnlock(
    { user }: UserTarget,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<UserRow> {
    const next = await this.repo.update(
      user.id,
      {
        status: user.status === 'locked' ? 'active' : user.status,
        lockedUntil: null,
        failedLoginCount: 0,
        updatedBy: actor.id,
      },
      tx,
    );
    if (!next) throw new AppException('USER_NOT_FOUND');
    await this.audit.record(
      {
        action: 'user.unlock',
        resourceType: 'user',
        resourceId: user.id,
        resourceName: next.email,
      },
      tx,
    );
    return next;
  }

  private async prepareStatus(
    id: string,
    status: BatchUserStatus,
    actor: AuthUser,
  ): Promise<UserTarget | null> {
    const user = await this.getExisting(id);
    if (user.status === status) return null;
    await this.assertStatusChangeAllowed(id, status, actor);
    return { user, roles: await this.repo.listRoles(id) };
  }

  private async applyStatus(
    { user }: UserTarget,
    status: BatchUserStatus,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<void> {
    const next = await this.repo.update(user.id, { status, updatedBy: actor.id }, tx);
    if (!next) throw new AppException('USER_NOT_FOUND');
    if (status !== 'active') await this.revokeSessions(user.id, tx);
    await this.audit.record(
      {
        action: 'user.update',
        resourceType: 'user',
        resourceId: user.id,
        resourceName: next.email,
        changes: diff(user, { status }, [...USER_AUDIT_FIELDS]),
      },
      tx,
    );
  }

  private publishUpdated(plans: readonly UserTarget[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: plans.map(({ user, roles }) => userUpdated(user.id, roles)),
      affectedUserIds: plans.map((plan) => plan.user.id),
    });
  }

  /** 狀態或 token_version 變了：JwtAuthGuard 的使用者快取與權限快取都要主動失效。 */
  private invalidateAccount(id: string): void {
    this.userCache.invalidate(id);
    this.permissionService.invalidateUser(id);
  }

  /** 停用：撤銷所有 refresh token 並讓既存 access token 失效。 */
  private async revokeSessions(id: string, tx: DbOrTx): Promise<void> {
    await this.repo.incrementTokenVersion(id, tx);
    await this.authTokens.revokeAllRefreshTokens(id, 'user_disabled', tx);
  }

  // ── 建立帳號：供 create 與審批（user.register）共用 ─────────────

  /** 建立前的檢查：email 未被使用、角色存在且 actor 指派得了（反提權）。 */
  async assertCreatable(email: string, roleIds: readonly string[], actor: AuthUser): Promise<void> {
    await this.assertEmailAvailable(email);
    await this.permissionService.assertRolesAssignable(actor.id, roleIds);
    await this.assertRolesExist(roleIds);
  }

  /**
   * 在呼叫端的交易內建立帳號、指派角色並寫稽核。呼叫前先 `assertCreatable()`；
   * 交易提交後呼叫 `publishCreated()`。
   */
  async createAccount(
    input: NewAccount,
    actor: AuthUser,
    tx: DbOrTx,
    metadata?: AuditMetadata,
  ): Promise<UserRow> {
    const user = await this.repo.create(
      {
        email: input.email,
        username: input.username ?? null,
        displayName: input.displayName,
        passwordHash: input.passwordHash ?? null,
        status: input.status,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      tx,
    );
    await this.repo.assignRoles(user.id, input.roleIds, actor.id, tx);
    await this.audit.record(
      {
        action: 'user.create',
        resourceType: 'user',
        resourceId: user.id,
        resourceName: user.email,
        // 密碼雜湊絕不進稽核
        changes: {
          after: { email: user.email, displayName: user.displayName, roles: input.roleIds },
        },
        metadata,
      },
      tx,
    );
    return user;
  }

  publishCreated(userId: string, roleIds: readonly string[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.USER,
          kind: ChangeKind.CREATE,
          id: userId,
          refs: { [ChangeSource.ROLE]: [...roleIds] },
        },
      ],
    });
  }

  // ── 業務規則 ─────────────────────────────────────────────

  private async getExisting(id: string): Promise<UserRow> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return user;
  }

  /** 改變帳號狀態：不能改自己；停用時不能讓 super-admin 歸零。 */
  private async assertStatusChangeAllowed(
    id: string,
    status: UserStatus,
    actor: AuthUser,
  ): Promise<void> {
    this.assertNotSelf(actor.id, id);
    if (status !== 'active') await this.assertNotLastSuperAdmin(id);
  }

  private assertNotSelf(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new AppException('AUTHZ_SELF_MODIFY');
  }

  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const remaining = await this.repo.countActiveUsersByRoleSlug(SUPER_ADMIN_SLUG, userId);
    const isSuper = (await this.permissionService.getPermissionSet(userId)).isSuperAdmin;
    if (isSuper && remaining < 1) throw new AppException('LAST_SUPER_ADMIN');
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.repo.findByEmail(email)) {
      throw new AppException('USER_EMAIL_DUPLICATE', { field: 'email', value: email });
    }
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    const { items } = await this.repo.list({
      offset: 0,
      limit: 1,
      keyword: username,
      sort: [{ sort: 'createdAt', order: 'desc' }],
    });
    if (items.some((item) => item.username?.toLowerCase() === username.toLowerCase())) {
      throw new AppException('USER_USERNAME_DUPLICATE', { field: 'username', value: username });
    }
  }

  private async assertRolesExist(roleIds: readonly string[]): Promise<void> {
    if (!roleIds.length) return;
    const found = await this.repo.findActiveRolesByIds(roleIds);
    if (found.length !== new Set(roleIds).size) throw new AppException('ROLE_NOT_FOUND');
  }

  // ── 帳號狀態與憑證：供 AuthModule 使用 ─────────────────────
  // 回傳含 passwordHash、tokenVersion 的 row，只給認證流程用，不可經由 controller 回傳。

  findAccountById(id: string): Promise<UserRow | undefined> {
    return this.repo.findById(id);
  }

  findAccountByEmail(email: string): Promise<UserRow | undefined> {
    return this.repo.findByEmail(email);
  }

  updateAccount(
    id: string,
    values: Partial<UserInsert>,
    tx?: DbOrTx,
  ): Promise<UserRow | undefined> {
    return this.repo.update(id, values, tx);
  }

  incrementTokenVersion(id: string, tx?: DbOrTx): Promise<void> {
    return this.repo.incrementTokenVersion(id, tx);
  }

  listRoleSummaries(id: string): Promise<UserRoleSummary[]> {
    return this.repo.listRoles(id);
  }
}
