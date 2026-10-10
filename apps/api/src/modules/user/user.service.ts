import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzService } from '@/core/authz';
import { UserCacheService } from '@/core/cache';
import type { Database, DbOrTx, MissedUpdateCodes, Transaction } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { ImageSources } from '@/core/image';
import { JobQueue } from '@/core/jobs';
import { RESOURCE_TYPE } from '@/core/resource';
import type { UserRow, UserStatus } from '@/db/schema';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
} from '@/db/schema';
import { AnnouncementTriggerService } from '@/modules/announcement/announcement-trigger.service';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { WatchService } from '@/modules/comment/watch.service';
import {
  ACTIVATION_MAIL_JOB,
  PASSWORD_RESET_MAIL_JOB,
} from '@/modules/credential/auth-mail.constants';
import { AuthTokenService } from '@/modules/credential/auth-token.service';
import { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import { IdentityProviderService } from '@/modules/identity-provider/identity-provider.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { OrgChartService } from '@/modules/organization/org-chart.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';
import type { TagSummaryDto } from '@/modules/tag/dto/tag.dto';
import { TagService } from '@/modules/tag/tag.service';
import { WebhookService } from '@/modules/webhook/webhook.service';

import type { CreateUserDto } from './dto/create-user.dto';
import type { ListUserDto } from './dto/list-user.dto';
import type { ReplaceUserRolesDto, UpdateUserDto } from './dto/update-user.dto';
import type { UserDto } from './dto/user.dto';
import { UserAccountService } from './user-account.service';
import { UserAvatarService } from './user-avatar.service';
import type { AvatarAuditChange } from './user-avatar.service';
import { USER_ROLE_ASSIGNED_TRIGGER } from './user.announcement-triggers';
import { userUpdated } from './user.changes';
import { USER_AUDIT_FIELDS } from './user.constants';
import { ACCOUNT_PROFILE_LINK, USER_ROLES_CHANGED_NOTIFICATION } from './user.notifications';
import type { UserRoleSummary, UserWithRoles } from './user.repository';
import { UserRepository } from './user.repository';
import { USER_DELETED_WEBHOOK, USER_RESTORED_WEBHOOK } from './user.webhooks';

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

function toDto(
  user: UserRow,
  roles: UserRoleSummary[],
  tags: TagSummaryDto[],
  avatar: ImageSources | null,
): UserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatar,
    avatarImageId: user.avatarImageId,
    status: displayStatusOf(user),
    roles,
    tags,
    locale: user.locale,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    mfaEnabled: user.mfaEnabled,
    version: user.version,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export { userUpdated } from './user.changes';

/** 欄位的差異加上頭像的變更（任一個沒有就只取另一個）。 */
function mergeChanges(
  fields: { before: object; after: object } | null,
  avatar: AvatarAuditChange | undefined,
): { before: object; after: object } | null {
  if (!avatar) return fields;
  return {
    before: { ...fields?.before, ...avatar.before },
    after: { ...fields?.after, ...avatar.after },
  };
}

function sameIds(roles: readonly Pick<UserRoleSummary, 'id'>[], ids: readonly string[]): boolean {
  const expected = new Set(ids);
  return roles.length === expected.size && roles.every((role) => expected.has(role.id));
}

/** 使用者寫入在交易提交後要做的事（`runAfterCommit`）。 */
export interface UserAfterCommit {
  /** 帳號狀態變了：使用者快取與權限快取失效。 */
  invalidateAccount?: string;
  /** 關係圖變了：整個租戶的權限失效（規則 7）。 */
  permissionsChanged?: readonly string[];
  /** 停用：踢掉這些人的連線。 */
  sessionsRevoked?: readonly string[];
  changes: ResourceChangeWire[];
  affectedUserIds?: readonly string[];
}

/** 樂觀鎖的條件式 UPDATE 沒命中時的錯誤碼（`missedUpdate`）。 */
const USER_LOCK_CODES = {
  notFound: 'USER_NOT_FOUND',
  conflict: 'USER_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

/**
 * 使用者管理的端點（列表、詳情、建立、編輯、刪除、還原、指派角色、代為重設密碼、解鎖）。
 * 登入流程與其他模組要用的帳號讀寫在 `UserAccountService`。
 */
@Injectable()
export class UserService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: UserRepository,
    private readonly accounts: UserAccountService,
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
    private readonly orgChart: OrgChartService,
    private readonly watches: WatchService,
    private readonly avatars: UserAvatarService,
    private readonly authz: AuthzService,
  ) {}

  async list(query: ListUserDto) {
    const { items, total } = await this.repo.list(query, {
      orgUnitIds: await this.orgUnitScope(query),
      roleHolderIds: await this.roleHolderScope(query),
    });
    const [tags, avatars] = await Promise.all([
      this.tags.tagsOf(
        RESOURCE_TYPE.USER,
        items.map((item) => item.id),
      ),
      this.avatars.avatarsOf(items),
    ]);
    return paginated(
      items.map((item: UserWithRoles) =>
        toDto(item, item.roles, tags.get(item.id) ?? [], avatars.get(item.id) ?? null),
      ),
      total,
      query,
    );
  }

  /**
   * 部門篩選展開成部門 id（docs/architecture/backend/23-organization.md §4）；組織管理未啟用時不靜靜地忽略。
   * 列表與匯出（`UserTransferResource`）共用。
   */
  async orgUnitScope(
    query: Pick<ListUserDto, 'orgUnitId' | 'includeDescendants'>,
  ): Promise<string[] | undefined> {
    if (!query.orgUnitId) return undefined;
    if (!this.orgChart.isEnabled()) {
      throw new AppException('VALIDATION_FAILED', { fields: { orgUnitId: 'feature disabled' } });
    }
    return this.orgChart.unitScope(query.orgUnitId, query.includeDescendants ?? false);
  }

  /**
   * `includeGroupRoles` 的角色篩選展開成持有者：直接或經由群組（含巢狀）持有任一角色的人，以關係圖反向展開一次查出
   * （與 MFA 政策的人數、公告受眾同一個查詢）。沒有要求時回 undefined，照舊只看直接持有。列表與匯出共用。
   */
  async roleHolderScope(
    query: Pick<ListUserDto, 'roleId' | 'includeGroupRoles'>,
  ): Promise<string[] | undefined> {
    if (!query.includeGroupRoles || !query.roleId?.length) return undefined;
    return this.authz.usersInSubjectSets(
      query.roleId.map((id) => ({ type: ROLE_OBJECT_TYPE, id, relation: ROLE_HOLDER_RELATION })),
    );
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.repo.findByIdWithRoles(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return toDto(user, user.roles, await this.tagsFor(id), await this.avatars.avatarOf(user));
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
    const { user, after } = await withTransaction(this.db, (tx) => this.createInTx(dto, actor, tx));
    await this.runAfterCommit(after);
    return toDto(user, await this.repo.listRoles(user.id), [], null);
  }

  /**
   * 建立的業務規則與寫入，在呼叫端的交易內（API 與匯入共用，docs/architecture/backend/22-data-transfer.md §7.4）。
   * 交易提交後要做的事（權限失效、推播）放在 `after`，由呼叫端執行：API 立即執行，匯入由框架合併後執行。
   */
  async createInTx(
    dto: CreateUserDto,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<{ user: UserRow; after: UserAfterCommit }> {
    await this.accounts.assertCreatable(dto.email, dto.roleIds, actor);
    const account = await this.accounts.createAccount(
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
    return {
      user: account,
      after: {
        permissionsChanged: dto.roleIds.length ? [account.id] : undefined,
        changes: [
          {
            resource: ChangeSource.USER,
            kind: ChangeKind.CREATE,
            id: account.id,
            refs: { [ChangeSource.ROLE]: [...dto.roleIds] },
          },
        ],
      },
    };
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserDto> {
    const { user, after } = await withTransaction(this.db, (tx) =>
      this.updateInTx(id, dto, actor, tx),
    );
    await this.runAfterCommit(after);
    return toDto(
      user,
      await this.repo.listRoles(id),
      await this.tagsFor(id),
      await this.avatars.avatarOf(user),
    );
  }

  /** 編輯的業務規則與寫入，在呼叫端的交易內（與 `createInTx` 同一個做法）。 */
  async updateInTx(
    id: string,
    dto: UpdateUserDto,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<{ user: UserRow; after: UserAfterCommit }> {
    const { version, avatarImageId, avatarCrop, ...fields } = dto;
    const user = await this.getExisting(id);
    // 讀到時就不同：別人已經改過，不必再做後面的檢查（docs/architecture/backend/14-revisions.md §9.2 D3）
    if (version !== user.version) {
      throw new AppException('USER_VERSION_CONFLICT', { current: user.version });
    }

    const statusChanging = dto.status !== undefined && dto.status !== user.status;
    if (statusChanging) {
      // `pending` 只能靠啟用信離開：收得到信才證明擁有這個 email（docs/architecture/backend/20-approval.md §5），
      // 管理者不能直接改成 active（平台管理者的 nextStatus() 同一條規則）
      if (user.status === 'pending' && dto.status === 'active') {
        throw new AppException('VALIDATION_FAILED', { fields: { status: 'pending' } });
      }
      this.assertNotSelf(actor.id, id);
      await this.assertCanManage(actor, id);
      // 停用後改回 active：他的角色與群組成員資格跟著重新生效，與還原同一個反提權（docs/architecture/backend/05-rbac.md §4.1）
      if (dto.status === 'active') await this.assertCanRevive(actor, id);
    }
    if (dto.username && dto.username !== user.username) {
      await this.assertUsernameAvailable(dto.username);
    }

    const fieldChanges = diff(user, dto, [...USER_AUDIT_FIELDS]);
    const deactivating = dto.status !== undefined && dto.status !== 'active';
    // 頭像：認領新的、解除舊的，與使用者的寫入同生共死（docs/architecture/backend/25-image.md §15.8）
    const avatar = await this.avatars.applyInTx(
      id,
      { imageId: avatarImageId, crop: avatarCrop },
      actor,
      tx,
    );
    const changes = mergeChanges(fieldChanges, avatar?.audit);

    if (statusChanging && deactivating) await this.assertNotLastSuperAdmin(id, tx);
    // 還沒啟用就停用：一併清掉註冊申請時存的密碼。否則之後改回 active，申請人不必收信就能以那組密碼登入；
    // 清掉之後只能經「重設密碼」設定，仍要證明擁有這個 email
    const discardPassword = statusChanging && user.status === 'pending';
    const next = await this.repo.update(
      id,
      {
        ...fields,
        ...(avatar ? { avatarImageId: avatar.avatarImageId } : {}),
        ...(discardPassword ? { passwordHash: null } : {}),
        updatedBy: actor.id,
      },
      tx,
      { expectedVersion: version, bumpVersion: true },
    );
    // 讀到之後、寫入之前被別人改過（版本變了）或刪除
    if (!next) throw await missedUpdate(() => this.repo.findVersion(id, tx), USER_LOCK_CODES);

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
    // 關注這位使用者的人（docs/architecture/backend/24-comment.md §4）；沒有實際改變時不通知
    if (changes) {
      await this.watches.resourceChanged(
        { resourceType: RESOURCE_TYPE.USER, resourceId: id, actorId: actor.id },
        tx,
      );
    }
    if (statusChanging) await this.accounts.emitStatusChanged(id, next.status, user.status, tx);

    const roles = await this.repo.listRoles(id, tx);
    return {
      user: next,
      after: {
        invalidateAccount: id,
        sessionsRevoked: deactivating ? [id] : undefined,
        changes: [userUpdated(id, roles)],
        affectedUserIds: [id],
      },
    };
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
   * 持有的角色中仍存在的那些、所屬的群組（與群組帶來的角色）隨著刪除時保留的邊自動生效，所以先以指派角色與加成員的反提權檢查它們；
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
    // 不能藉還原讓別人取得自己給不了的角色（含 super-admin、經由群組持有的；docs/architecture/backend/05-rbac.md §4.1）
    const roles = await this.assertCanRevive(actor, id);

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
    return toDto(restored, roles, await this.tagsFor(id), await this.avatars.avatarOf(restored));
  }

  /** PUT：整批取代語意。 */
  async replaceRoles(
    id: string,
    dto: ReplaceUserRolesDto,
    actor: AuthUser,
  ): Promise<{ roles: UserRoleSummary[] }> {
    const { after } = await withTransaction(this.db, (tx) =>
      this.replaceRolesInTx(id, dto, actor, tx),
    );
    await this.runAfterCommit(after);
    return { roles: await this.repo.listRoles(id) };
  }

  /** 整批取代角色的業務規則與寫入，在呼叫端的交易內（與 `createInTx` 同一個做法）。 */
  async replaceRolesInTx(
    id: string,
    dto: ReplaceUserRolesDto,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<{ before: UserRoleSummary[]; after: UserAfterCommit }> {
    const user = await this.getExisting(id);
    this.assertNotSelf(actor.id, id);
    await this.assertCanManage(actor, id);
    await this.permissionService.assertRolesAssignable(actor.id, dto.roleIds);
    await this.accounts.assertRolesExist(dto.roleIds);
    const roles = await this.repo.findActiveRolesByIds(dto.roleIds);

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
      await this.watches.resourceChanged(
        { resourceType: RESOURCE_TYPE.USER, resourceId: id, actorId: actor.id },
        tx,
      );
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

    // 新舊角色都要通知：兩邊的 userCount 與持有者清單都變了
    const roleIds = [...new Set([...current.map((role) => role.id), ...dto.roleIds])];
    return {
      before: current,
      after: {
        permissionsChanged: [id],
        changes: [
          {
            resource: ChangeSource.USER_ROLE,
            kind: ChangeKind.UPDATE,
            id,
            refs: { [ChangeSource.ROLE]: roleIds },
          },
        ],
        affectedUserIds: [id],
      },
    };
  }

  /**
   * 交易提交後的副作用（規則 6、7：先失效再發佈）。API 在交易後立即呼叫；匯入的套用工作把它拆成可合併的副作用
   * （`UserTransferResource`），每 100 列才做一次全租戶的權限失效（docs/architecture/backend/22-data-transfer.md §13 D10）。
   */
  async runAfterCommit(after: UserAfterCommit): Promise<void> {
    if (after.invalidateAccount) this.invalidateAccount(after.invalidateAccount);
    if (after.permissionsChanged?.length) {
      await this.permissionService.permissionsChanged(after.permissionsChanged);
    }
    if (after.sessionsRevoked?.length) {
      this.events.publish(DomainEvent.SESSIONS_REVOKED, {
        userIds: [...after.sessionsRevoked],
        reason: SessionRevokedReason.ACCOUNT_DISABLED,
      });
    }
    if (after.changes.length) {
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: after.changes,
        ...(after.affectedUserIds?.length ? { affectedUserIds: [...after.affectedUserIds] } : {}),
      });
    }
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
    if (!isLoginLocked(user)) throw new AppException('USER_NOT_LOCKED');
    const roles = await this.repo.listRoles(id);

    const updated = await withTransaction(this.db, async (tx) => {
      const next = await this.repo.update(
        id,
        { lockedUntil: null, failedLoginCount: 0, updatedBy: actor.id },
        tx,
        // 解鎖改變了顯示的狀態：開著的編輯表單要知道自己看到的是舊的
        { bumpVersion: true },
      );
      if (!next) throw new AppException('USER_NOT_FOUND');
      await this.audit.record(
        { action: 'user.unlock', resourceType: 'user', resourceId: id, resourceName: next.email },
        tx,
      );
      return next;
    });

    this.userCache.invalidate(id);
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(id, roles)],
      affectedUserIds: [id],
    });
    return toDto(updated, roles, await this.tagsFor(id), await this.avatars.avatarOf(updated));
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

  // ── 業務規則 ─────────────────────────────────────────────

  private async getExisting(id: string): Promise<UserRow> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    return user;
  }

  private assertNotSelf(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new AppException('AUTHZ_SELF_MODIFY');
  }

  /**
   * 「永遠至少有一位可用的 super-admin」（docs/architecture/iam/01-model.md I8）。在寫入的交易內呼叫：
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
   * 讓一位使用者原本的權限重新生效（還原、停用後改回 active）之前的反提權：刪除與停用都不動關係圖，
   * 他直接持有的角色與直接所屬的群組（引擎沿上層群組、群組持有的角色展開）會原樣回來，
   * 等於重新指派那些角色、重新把他加進那些群組——帶來的租戶能力操作者都要有（docs/architecture/backend/05-rbac.md §4.1）。
   * 回傳他直接持有的角色（稽核與推播用）。
   */
  private async assertCanRevive(actor: AuthUser, id: string): Promise<UserRoleSummary[]> {
    const [roles, groupIds] = await Promise.all([
      this.repo.listRoles(id),
      this.repo.listGroupIds(id),
    ]);
    await this.permissionService.assertCanGrant(actor.id, [
      ...roles.map((role) => ({
        object: { type: ROLE_OBJECT_TYPE, id: role.id },
        relation: ROLE_HOLDER_RELATION,
      })),
      ...groupIds.map((groupId) => ({
        object: { type: GROUP_OBJECT_TYPE, id: groupId },
        relation: GROUP_MEMBER_RELATION,
      })),
    ]);
    return roles;
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

  /**
   * 精確比對（citext，不分大小寫）。不用列表的關鍵字搜尋：部分比對會先命中較新的 `bobby`，
   * 漏掉真正佔用的 `bob`，只剩唯一索引兜底（回應沒有 `details`）。
   */
  private async assertUsernameAvailable(username: string): Promise<void> {
    if (await this.repo.findByUsername(username)) {
      throw new AppException('USER_USERNAME_DUPLICATE', { field: 'username', value: username });
    }
  }
}
