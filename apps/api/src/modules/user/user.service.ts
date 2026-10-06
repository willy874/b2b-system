import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { JobQueue } from '@/core/jobs';
import { RESOURCE_TYPE } from '@/core/resource';
import type { AuditMetadata, UserInsert, UserRow, UserStatus } from '@/db/schema';
import { AnnouncementTriggerService } from '@/modules/announcement/announcement-trigger.service';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import {
  ACTIVATION_MAIL_JOB,
  PASSWORD_RESET_MAIL_JOB,
} from '@/modules/credential/auth-mail.constants';
import { AuthTokenService } from '@/modules/credential/auth-token.service';
import { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import { IdentityProviderService } from '@/modules/identity-provider/identity-provider.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';
import type { TagSummaryDto } from '@/modules/tag/dto/tag.dto';
import { TagService } from '@/modules/tag/tag.service';
import { WebhookService } from '@/modules/webhook/webhook.service';

import type { CreateUserDto } from './dto/create-user.dto';
import type { ListUserDto } from './dto/list-user.dto';
import type { ReplaceUserRolesDto, UpdateUserDto } from './dto/update-user.dto';
import type { UserDto } from './dto/user.dto';
import { USER_ACTIVATED_TRIGGER, USER_ROLE_ASSIGNED_TRIGGER } from './user.announcement-triggers';
import { USER_AUDIT_FIELDS, USER_VERSIONED_FIELDS } from './user.constants';
import { ACCOUNT_PROFILE_LINK, USER_ROLES_CHANGED_NOTIFICATION } from './user.notifications';
import type { FailedLoginResult, UserRoleSummary, UserWithRoles } from './user.repository';
import { UserRepository } from './user.repository';
import {
  USER_CREATED_WEBHOOK,
  USER_DELETED_WEBHOOK,
  USER_RESTORED_WEBHOOK,
  USER_STATUS_CHANGED_WEBHOOK,
} from './user.webhooks';

/** `createAccount()` 的輸入：`passwordHash` 為 null 時帳號必須走啟用信流程（status = pending）。 */
export interface NewAccount {
  email: string;
  username?: string | null;
  displayName: string;
  passwordHash?: string | null;
  status: UserStatus;
  roleIds: readonly string[];
}

/** 登入失敗的自動鎖定是否還在生效（`locked_until` 還沒到期；docs/architecture/backend/04-auth.md §3.3）。 */
export function isLoginLocked(user: Pick<UserRow, 'lockedUntil'>, now = Date.now()): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now;
}

/**
 * 對外顯示的狀態：自動鎖定只寫 `locked_until`、不改 `status`（鎖定不踢掉已登入的 session），
 * 鎖定中的 `active` 顯示為 `locked`，到期後自動回到 `active`。
 */
export function displayStatusOf(user: Pick<UserRow, 'status' | 'lockedUntil'>): UserStatus {
  return user.status === 'active' && isLoginLocked(user) ? 'locked' : user.status;
}

function toDto(user: UserRow, roles: UserRoleSummary[], tags: TagSummaryDto[]): UserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: displayStatusOf(user),
    roles,
    tags,
    locale: user.locale,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    version: user.version,
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

/** 這次寫入是否動到遞增 `version` 的欄位（`USER_VERSIONED_FIELDS`）。 */
function touchesVersionedFields(values: Partial<UserInsert>): boolean {
  return USER_VERSIONED_FIELDS.some((field) => values[field] !== undefined);
}

function sameIds(roles: readonly Pick<UserRoleSummary, 'id'>[], ids: readonly string[]): boolean {
  const expected = new Set(ids);
  return roles.length === expected.size && roles.every((role) => expected.has(role.id));
}

@Injectable()
export class UserService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: UserRepository,
    private readonly permissionService: PermissionService,
    private readonly authTokens: AuthTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly identities: IdentityProviderService,
    private readonly jobs: JobQueue,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly notifications: NotificationService,
    private readonly webhooks: WebhookService,
    private readonly tags: TagService,
    private readonly announcementTriggers: AnnouncementTriggerService,
  ) {}

  async list(query: ListUserDto) {
    const { items, total } = await this.repo.list(query);
    const tags = await this.tags.tagsOf(
      RESOURCE_TYPE.USER,
      items.map((item) => item.id),
    );
    return paginated(
      items.map((item: UserWithRoles) => toDto(item, item.roles, tags.get(item.id) ?? [])),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.repo.findByIdWithRoles(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return toDto(user, user.roles, await this.tagsFor(id));
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

    const created = await withTransaction(this.db, async (tx) => {
      const account = await this.createAccount(
        {
          email: dto.email,
          username: dto.username ?? null,
          displayName: dto.displayName,
          status: 'pending', // 不接受 password：一律走啟用信流程
          roleIds: dto.roleIds,
        },
        actor,
        tx,
      );
      // 與帳號同生共死：建立失敗就不會寄出啟用信（docs/architecture/backend/11-mail.md §4）
      await this.jobs.enqueue(ACTIVATION_MAIL_JOB, { userId: account.id }, { tx });
      return account;
    });

    await this.publishCreated(created.id, dto.roleIds);
    return toDto(created, await this.repo.listRoles(created.id), []);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserDto> {
    const { version, ...fields } = dto;
    const user = await this.getExisting(id);
    // 讀到時就不同：別人已經改過，不必再做後面的檢查（docs/architecture/backend/14-revisions.md §9.2 D3）
    if (version !== user.version) {
      throw new AppException('USER_VERSION_CONFLICT', { current: user.version });
    }

    const statusChanging = dto.status !== undefined && dto.status !== user.status;
    if (statusChanging) {
      // `pending` 只能靠啟用信離開：收得到信才證明擁有這個 email（docs/rbac/06-approval.md §5），
      // 管理者不能直接改成 active（平台管理者的 nextStatus() 同一條規則）
      if (user.status === 'pending' && dto.status === 'active') {
        throw new AppException('VALIDATION_FAILED', { fields: { status: 'pending' } });
      }
      this.assertNotSelf(actor.id, id);
      await this.assertCanManage(actor, id);
    }
    if (dto.username && dto.username !== user.username) {
      await this.assertUsernameAvailable(dto.username);
    }

    const changes = diff(user, dto, [...USER_AUDIT_FIELDS]);
    const deactivating = dto.status !== undefined && dto.status !== 'active';

    const updated = await withTransaction(this.db, async (tx) => {
      if (statusChanging && deactivating) await this.assertNotLastSuperAdmin(id, tx);
      // 還沒啟用就停用：一併清掉註冊申請時存的密碼。否則之後改回 active，申請人不必收信就能以那組密碼登入；
      // 清掉之後只能經「重設密碼」設定，仍要證明擁有這個 email
      const discardPassword = statusChanging && user.status === 'pending';
      const next = await this.repo.update(
        id,
        { ...fields, ...(discardPassword ? { passwordHash: null } : {}), updatedBy: actor.id },
        tx,
        { expectedVersion: version, bumpVersion: true },
      );
      // 讀到之後、寫入之前被別人改過（版本變了）或刪除
      if (!next) throw await this.missedUpdate(id, tx);

      if (deactivating) {
        // 停用：撤銷所有 refresh token 並讓既存 access token 失效；已寄出的啟用／重設連結一併作廢，
        // 否則還沒啟用的人可以用啟用信把自己改回 active
        await this.repo.incrementTokenVersion(id, tx);
        await this.refreshTokens.revokeAllForUser(id, 'user_disabled', tx);
        await this.authTokens.revokeUnused(id, tx);
      }

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
      if (statusChanging) await this.emitStatusChanged(id, next.status, user.status, tx);
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
    return toDto(updated, roles, await this.tagsFor(id));
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const user = await this.getExisting(id);
    this.assertNotSelf(actor.id, id);
    await this.assertCanManage(actor, id);
    // 先查角色再刪：推播要帶上受影響的角色（userCount）
    const roles = await this.repo.listRoles(id);

    await withTransaction(this.db, async (tx) => {
      await this.assertNotLastSuperAdmin(id, tx);
      await this.repo.softDelete(id, actor.id, tx);
      await this.refreshTokens.revokeAllForUser(id, 'user_disabled', tx);
      await this.authTokens.revokeUnused(id, tx);
      // 軟刪除不觸發 cascade：外部身分的連結要自己刪，同 email 重建的帳號才能再連結
      const identitiesUnlinked = await this.identities.unlinkUser(id, tx);
      await this.audit.record(
        {
          action: 'user.delete',
          resourceType: 'user',
          resourceId: id,
          resourceName: user.email,
          changes: { before: { email: user.email, status: user.status } },
          metadata: identitiesUnlinked ? { identitiesUnlinked } : undefined,
        },
        tx,
      );
      await this.webhooks.emit(USER_DELETED_WEBHOOK, { userId: id }, tx);
    });

    this.invalidateAccount(id);
    // softDelete 遞增了 token_version
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      userIds: [id],
      reason: SessionRevokedReason.TOKEN_INVALID,
    });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.USER,
          kind: ChangeKind.DELETE,
          id,
          refs: { [ChangeSource.ROLE]: roles.map((role) => role.id) },
        },
      ],
    });
  }

  /**
   * 還原刪除的使用者（docs/architecture/backend/14-revisions.md §9.2 D6）：清 `deleted_at`，`status` 維持刪除前的值；refresh token、外部身分連結、
   * 刪除時作廢的啟用／重設連結都不回復（要重新登入、重新連結；還沒啟用的人由「重設密碼」重寄啟用信）。
   * 持有的角色中仍存在的那些隨著刪除時保留的邊自動生效，所以先以指派角色的反提權檢查它們；
   * 個人資料夾由 `permissions.changed` 的訂閱者（檔案模組）補建。
   */
  async restore(id: string, actor: AuthUser): Promise<UserDto> {
    const user = await this.repo.findDeletedById(id);
    if (!user) {
      throw new AppException(
        (await this.repo.findById(id)) ? 'USER_NOT_DELETED' : 'USER_NOT_FOUND',
      );
    }
    await this.assertRestorable(user);
    // 不能藉還原讓別人取得自己給不了的角色（含 super-admin；docs/architecture/backend/05-rbac.md §4.1）
    const roles = await this.repo.listRoles(id);
    await this.permissionService.assertRolesAssignable(
      actor.id,
      roles.map((role) => role.id),
    );

    const restored = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('USER_NOT_DELETED');
      await this.audit.record(
        {
          action: 'user.restore',
          resourceType: RESOURCE_TYPE.USER,
          resourceId: id,
          resourceName: row.email,
          changes: { after: { email: row.email, status: row.status } },
          metadata: { deletedAt: user.deletedAt?.toISOString(), roles: roles.map((r) => r.slug) },
        },
        tx,
      );
      await this.webhooks.emit(USER_RESTORED_WEBHOOK, { userId: id }, tx);
      return row;
    });

    this.invalidateAccount(id);
    // 持有者邊重新生效（而且個人資料夾的補建靠這個事件的 userIds）：不論有沒有角色都通知
    await this.permissionService.permissionsChanged([id]);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.USER,
          kind: ChangeKind.CREATE,
          id,
          refs: { [ChangeSource.ROLE]: roles.map((role) => role.id) },
        },
      ],
      affectedUserIds: [id],
    });
    return toDto(restored, roles, await this.tagsFor(id));
  }

  /** PUT：整批取代語意。 */
  async replaceRoles(
    id: string,
    dto: ReplaceUserRolesDto,
    actor: AuthUser,
  ): Promise<{ roles: UserRoleSummary[] }> {
    const user = await this.getExisting(id);
    this.assertNotSelf(actor.id, id);
    await this.assertCanManage(actor, id);
    await this.permissionService.assertRolesAssignable(actor.id, dto.roleIds);
    await this.assertRolesExist(dto.roleIds);
    const roles = await this.repo.findActiveRolesByIds(dto.roleIds);

    const before = await withTransaction(this.db, async (tx) => {
      // 同一個人的並行指派依序執行；`current` 在鎖內讀，稽核與衝突判斷才是真正被取代的那一份
      await this.repo.lockForUpdate(id, tx);
      const current = await this.repo.listRoles(id, tx);
      if (!sameIds(current, dto.expectedRoleIds)) {
        // 送出的草稿是以舊的角色為基礎：別人剛改過，整批取代會把那次變更蓋掉
        throw new AppException('USER_ROLES_CONFLICT', {
          currentRoleIds: current.map((role) => role.id),
        });
      }
      const losingSuperAdmin =
        current.some((role) => role.slug === SUPER_ADMIN_SLUG) &&
        !roles.some((role) => role.slug === SUPER_ADMIN_SLUG);
      if (losingSuperAdmin) await this.assertNotLastSuperAdmin(id, tx);

      await this.repo.replaceRoles(id, dto.roleIds, actor.id, tx);
      await this.audit.record(
        {
          action: 'user.assignRole',
          resourceType: 'user',
          resourceId: id,
          resourceName: user.email,
          changes: {
            before: { roles: current.map((role) => role.slug) },
            after: { roles: roles.map((role) => role.slug) },
          },
        },
        tx,
      );
      // 通知被改的那個人（docs/architecture/backend/15-notification.md §12.2 D11）；沒有實際增減（例：只是重送同一組）就不通知
      const currentIds = new Set(current.map((role) => role.id));
      const nextIds = new Set(roles.map((role) => role.id));
      const added = roles.filter((role) => !currentIds.has(role.id)).map((role) => role.name);
      const removed = current.filter((role) => !nextIds.has(role.id)).map((role) => role.name);
      const addedRoleIds = roles.filter((role) => !currentIds.has(role.id)).map((role) => role.id);
      if (addedRoleIds.length) {
        await this.announcementTriggers.fire(
          USER_ROLE_ASSIGNED_TRIGGER,
          { userIds: [id], roleIds: addedRoleIds },
          tx,
        );
      }
      if (added.length || removed.length) {
        await this.notifications.notify(
          notification(USER_ROLES_CHANGED_NOTIFICATION, {
            recipientId: id,
            actorId: actor.id,
            params: { added, removed },
            link: ACCOUNT_PROFILE_LINK,
          }),
          tx,
        );
      }
      return current;
    });

    await this.permissionService.permissionsChanged([id]);
    // 新舊角色都要通知：兩邊的 userCount 與持有者清單都變了
    const roleIds = [...new Set([...before.map((role) => role.id), ...dto.roleIds])];
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

  /**
   * 代為重設密碼：寄重設信。還沒啟用（`pending`）的人改寄 **啟用信**——重設不會把 `pending` 改成 `active`，
   * 啟用信過期或寄送失敗後這是唯一的重寄路徑。
   */
  async resetPassword(id: string, actor: AuthUser): Promise<{ sent: true }> {
    const user = await this.getExisting(id);
    const activation = user.status === 'pending';
    const job = activation ? ACTIVATION_MAIL_JOB : PASSWORD_RESET_MAIL_JOB;
    await withTransaction(this.db, async (tx) => {
      await this.jobs.enqueue(job, { userId: id }, { tx });
      await this.audit.record(
        {
          action: activation ? 'user.activation_resent' : 'user.reset_password_requested',
          resourceType: 'user',
          resourceId: id,
          resourceName: user.email,
          actorId: actor.id,
          actorEmail: actor.email,
        },
        tx,
      );
    });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.USER_CREDENTIAL, kind: ChangeKind.UPDATE, id }],
    });
    return { sent: true };
  }

  async unlock(id: string, actor: AuthUser): Promise<UserDto> {
    const user = await this.getExisting(id);
    const locked = user.status === 'locked' || isLoginLocked(user);
    if (!locked) throw new AppException('USER_NOT_LOCKED');
    const roles = await this.repo.listRoles(id);

    const updated = await withTransaction(this.db, async (tx) => {
      const next = await this.repo.update(
        id,
        {
          status: user.status === 'locked' ? 'active' : user.status,
          lockedUntil: null,
          failedLoginCount: 0,
          updatedBy: actor.id,
        },
        tx,
        // 解鎖改變了顯示的狀態：開著的編輯表單要知道自己看到的是舊的
        { bumpVersion: true },
      );
      if (!next) throw new AppException('USER_NOT_FOUND');
      await this.audit.record(
        { action: 'user.unlock', resourceType: 'user', resourceId: id, resourceName: next.email },
        tx,
      );
      // 登入失敗的自動鎖定只寫 locked_until、不改 status：只有 status 真的改變時才是對外的狀態變化
      if (next.status !== user.status) {
        await this.emitStatusChanged(id, next.status, user.status, tx);
      }
      return next;
    });

    this.userCache.invalidate(id);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(id, roles)],
      affectedUserIds: [id],
    });
    return toDto(updated, roles, await this.tagsFor(id));
  }

  /**
   * 使用者的標籤被改了（`TagService` 在交易提交後呼叫，docs/architecture/backend/18-tag.md §7.2 D10）：推一筆使用者更新，
   * 列表與詳情重抓。標籤不屬於樂觀鎖的欄位，不遞增 `version`。
   */
  async publishTagsChanged(id: string): Promise<void> {
    const roles = await this.repo.listRoles(id);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(id, roles)],
      affectedUserIds: [id],
    });
  }

  private async tagsFor(id: string): Promise<TagSummaryDto[]> {
    return (await this.tags.tagsOf(RESOURCE_TYPE.USER, [id])).get(id) ?? [];
  }

  /** 狀態或 token_version 變了：JwtAuthGuard 的使用者快取與權限快取都要主動失效。 */
  private invalidateAccount(id: string): void {
    this.userCache.invalidate(id);
    this.permissionService.invalidateUser(id);
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
   * 交易提交後呼叫 `publishCreated()`。`actor` 為 null：沒有人代為建立
   * （外部 IdP 登入時自動建立的帳號）。
   */
  async createAccount(
    input: NewAccount,
    actor: AuthUser | null,
    tx: Transaction,
    metadata?: AuditMetadata,
  ): Promise<UserRow> {
    const user = await this.repo.create(
      {
        email: input.email,
        username: input.username ?? null,
        displayName: input.displayName,
        passwordHash: input.passwordHash ?? null,
        status: input.status,
        createdBy: actor?.id ?? null,
        updatedBy: actor?.id ?? null,
      },
      tx,
    );
    await this.repo.assignRoles(user.id, input.roleIds, actor?.id ?? null, tx);
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
    await this.webhooks.emit(USER_CREATED_WEBHOOK, { userId: user.id }, tx);
    // 建立時就能登入（外部 IdP 首次登入、管理者直接設密碼）：與完成啟用同一個觸發點
    if (input.status === 'active') {
      await this.announcementTriggers.fire(USER_ACTIVATED_TRIGGER, { userIds: [user.id] }, tx);
    }
    return user;
  }

  /**
   * 對外事件 `user.statusChanged`（docs/architecture/backend/17-webhook.md §9.2 D2）：在改變狀態的交易內（稽核之後）呼叫。
   * 啟用帳號（`pending` → `active`）在 `AuthService` 完成，也經由這裡發出。
   */
  async emitStatusChanged(
    userId: string,
    status: UserStatus,
    previousStatus: UserStatus,
    tx: Transaction,
  ): Promise<void> {
    await this.webhooks.emit(USER_STATUS_CHANGED_WEBHOOK, { userId, status, previousStatus }, tx);
    // 完成啟用（pending → active）；停用後恢復、解鎖都不算
    if (previousStatus === 'pending' && status === 'active') {
      await this.announcementTriggers.fire(USER_ACTIVATED_TRIGGER, { userIds: [userId] }, tx);
    }
  }

  async publishCreated(userId: string, roleIds: readonly string[]): Promise<void> {
    // 帶角色建立＝權限從無到有：訂閱者（例：檔案模組建立個人資料夾）跟著反應
    if (roleIds.length > 0) await this.permissionService.permissionsChanged([userId]);
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

  /**
   * 條件式 UPDATE 沒有命中：列已不在 → 404；還在就是版本被搶先改過 → 409 並帶重讀的目前版本
   * （docs/architecture/backend/14-revisions.md §9.2 D3）。在同一個交易內重讀，看得到搶先的那一筆已提交的版本。
   */
  private async missedUpdate(id: string, tx: DbOrTx): Promise<AppException> {
    const current = await this.repo.findVersion(id, tx);
    return current === undefined
      ? new AppException('USER_NOT_FOUND')
      : new AppException('USER_VERSION_CONFLICT', { current });
  }

  private async getExisting(id: string): Promise<UserRow> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return user;
  }

  private assertNotSelf(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new AppException('AUTHZ_SELF_MODIFY');
  }

  /**
   * 「永遠至少有一位可用的 super-admin」（docs/rbac/01-domain-model.md I8）。在寫入的交易內呼叫：
   * 先取得 advisory lock 再計數，兩個並行的停用／刪除／拔角色不會同時看到「還剩一位」。
   * 是不是 super-admin 直接查 DB，不經權限快取。
   */
  private async assertNotLastSuperAdmin(userId: string, tx: DbOrTx): Promise<void> {
    await this.repo.lockSuperAdminGuard(tx);
    if (!(await this.repo.hasRoleSlug(userId, SUPER_ADMIN_SLUG, tx))) return;
    const remaining = await this.repo.countActiveUsersByRoleSlug(SUPER_ADMIN_SLUG, userId, tx);
    if (remaining < 1) throw new AppException('LAST_SUPER_ADMIN');
  }

  /**
   * 反提權（對「被操作的人」）：持有 super-admin 的人只有 super-admin 能停用、刪除或改角色
   * （docs/architecture/backend/05-rbac.md §4.1）。否則持 `user:*` 的 admin 就能排除上級。
   */
  private async assertCanManage(actor: AuthUser, targetId: string): Promise<void> {
    if (!(await this.repo.hasRoleSlug(targetId, SUPER_ADMIN_SLUG))) return;
    if (await this.repo.hasRoleSlug(actor.id, SUPER_ADMIN_SLUG)) return;
    throw new AppException('AUTHZ_ESCALATION', { role: SUPER_ADMIN_SLUG, target: targetId });
  }

  /**
   * 還原前的唯一值檢查：email 或 username 已被 **未刪除** 的帳號使用 → 409，`details.conflictingUserId`
   * 帶佔用者，前端直接連過去（email 不能改，管理者只能先處理那個帳號；docs/architecture/backend/14-revisions.md §9.2 D6）。
   */
  private async assertRestorable(user: UserRow): Promise<void> {
    const emailTaken = await this.repo.findByEmail(user.email);
    if (emailTaken) {
      throw new AppException('USER_EMAIL_DUPLICATE', {
        field: 'email',
        value: user.email,
        conflictingUserId: emailTaken.id,
      });
    }
    const usernameTaken = user.username ? await this.repo.findByUsername(user.username) : undefined;
    if (usernameTaken) {
      throw new AppException('USER_USERNAME_DUPLICATE', {
        field: 'username',
        value: user.username,
        conflictingUserId: usernameTaken.id,
      });
    }
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

  /** 動到可編輯的欄位（個人資料、啟用後的狀態）時遞增 `version`；登入計數、密碼等不遞增。 */
  updateAccount(
    id: string,
    values: Partial<UserInsert>,
    tx?: DbOrTx,
  ): Promise<UserRow | undefined> {
    return this.repo.update(id, values, tx, { bumpVersion: touchesVersionedFields(values) });
  }

  incrementTokenVersion(id: string, tx?: DbOrTx): Promise<void> {
    return this.repo.incrementTokenVersion(id, tx);
  }

  /** 登入失敗的原子計數與鎖定（`UserRepository.recordFailedLogin`）。 */
  recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<FailedLoginResult | undefined> {
    return this.repo.recordFailedLogin(id, maxAttempts, lockoutSeconds);
  }

  listRoleSummaries(id: string): Promise<UserRoleSummary[]> {
    return this.repo.listRoles(id);
  }
}
