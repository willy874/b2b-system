import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { parseSubjectKey } from '@/core/authz';
import type { DbOrTx, Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { AuditMetadata, RoleRow, UserInsert, UserRow, UserStatus } from '@/db/schema';
import { AnnouncementTriggerService } from '@/modules/announcement/announcement-trigger.service';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { WebhookService } from '@/modules/webhook/webhook.service';

import { USER_ACTIVATED_TRIGGER } from './user.announcement-triggers';
import { USER_VERSIONED_FIELDS } from './user.constants';
import type { FailedLoginResult, UserRoleSummary } from './user.repository';
import { UserRepository } from './user.repository';
import { USER_CREATED_WEBHOOK, USER_STATUS_CHANGED_WEBHOOK } from './user.webhooks';

/** `createAccount()` 的輸入：`passwordHash` 為 null 時帳號必須走啟用信流程（status = pending）。 */
export interface NewAccount {
  email: string;
  username?: string | null;
  displayName: string;
  passwordHash?: string | null;
  status: UserStatus;
  roleIds: readonly string[];
}

/** 這次寫入是否動到遞增 `version` 的欄位（`USER_VERSIONED_FIELDS`）。 */
function touchesVersionedFields(values: Partial<UserInsert>): boolean {
  return USER_VERSIONED_FIELDS.some((field) => values[field] !== undefined);
}

/**
 * 帳號本身的讀寫，給 **使用者管理以外** 的流程用：登入、續期、SSO 與外部 IdP（`AuthModule`）、
 * OIDC Provider、註冊審批的 handler，以及 `UserService` 的建立與改狀態。
 * 管理端點（列表、編輯、刪除、還原、指派角色…）在 `UserService`，兩者同一個模組、一起匯出
 * （docs/architecture/backend/01-architecture.md §4）。
 *
 * `findAccount*` 回傳含 `passwordHash`、`tokenVersion` 的 row，只給認證流程用，不可經由 controller 回傳。
 */
@Injectable()
export class UserAccountService {
  constructor(
    private readonly repo: UserRepository,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly webhooks: WebhookService,
    private readonly announcementTriggers: AnnouncementTriggerService,
  ) {}

  // ── 建立帳號：供 UserService.create 與審批（user.register）、外部 IdP 首次登入共用 ─────────────

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

  /** 角色都存在（未刪除）；建立帳號與 `UserService.replaceRoles()` 共用。 */
  async assertRolesExist(roleIds: readonly string[]): Promise<void> {
    if (!roleIds.length) return;
    const found = await this.repo.findActiveRolesByIds(roleIds);
    if (found.length !== new Set(roleIds).size) throw new AppException('ROLE_NOT_FOUND');
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.repo.findByEmail(email)) {
      throw new AppException('USER_EMAIL_DUPLICATE', { field: 'email', value: email });
    }
  }

  // ── 帳號狀態與憑證：供 AuthModule 使用 ─────────────────────

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

  /**
   * 實際持有的（未刪除的）角色：直接持有，加上經由群組（含巢狀）持有的——群組 g 持有 r 時，g 的成員都持有 r
   * （docs/architecture/iam/07-groups.md §1）。取自權限解析的主體閉包（`role:<id>#holder`），不另外維護一份遞迴查詢。
   */
  async listEffectiveRoles(id: string): Promise<Pick<RoleRow, 'id' | 'slug' | 'isSystem'>[]> {
    const { subjects } = await this.permissionService.getPermissionSet(id);
    if (!subjects) return this.repo.listRoles(id);
    const roleIds = subjects.flatMap((key) => {
      const { object, relation } = parseSubjectKey(key);
      return object.type === 'role' && relation === 'holder' ? [object.id] : [];
    });
    return this.repo.findActiveRolesByIds(roleIds);
  }
}
