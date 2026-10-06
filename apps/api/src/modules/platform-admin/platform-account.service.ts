import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { UserCacheService } from '@/core/cache';
import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { hashPassword, verifyPassword } from '@/modules/credential/password';

import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthTokenRepository } from './platform-auth-token.repository';

/**
 * 平台管理者從信中連結設定密碼（啟用、重設；同租戶的 `/auth/setup`、`/auth/reset-password`）。
 * token 無效、過期、用過一律 `AUTH_SETUP_TOKEN_INVALID`，不區分原因。
 * 另有已登入的管理者自己改名稱與密碼（apps/platform 的個人資料頁，同租戶的 `PATCH /auth/profile`、`/auth/change-password`）。
 *
 * 每個流程與租戶的 `AuthService` 相同：一個交易內依序「條件式消耗 token → 寫入 → 稽核」，
 * 交易提交後才失效快取、發事件（CLAUDE.md 後端規則 6）。
 */
@Injectable()
export class PlatformAccountService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly repo: PlatformAdminRepository,
    private readonly tokens: PlatformAuthTokenRepository,
    private readonly audit: PlatformAuditService,
    private readonly userCache: UserCacheService,
    private readonly events: DomainEventBus,
  ) {}

  async verifySetupToken(raw: string): Promise<{ valid: boolean; email?: string }> {
    const token = await this.tokens.findUsable(raw, 'activation');
    const admin = token && (await this.repo.findById(token.adminId));
    return admin ? { valid: true, email: admin.email } : { valid: false };
  }

  async setup(raw: string, password: string): Promise<{ success: true }> {
    const token = await this.tokens.findUsable(raw, 'activation');
    const admin = token && (await this.repo.findById(token.adminId));
    if (!token || !admin || admin.status !== 'pending') {
      throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    }
    // argon2 在交易外算：不佔著交易等雜湊
    const passwordHash = await hashPassword(password);
    await withTransaction(this.db, async (tx) => {
      // 併發送出同一張 token：只有一個搶得到
      if (!(await this.tokens.markUsed(token.id, tx))) {
        throw new AppException('AUTH_SETUP_TOKEN_INVALID');
      }
      const activated = await this.repo.update(admin.id, { passwordHash, status: 'active' }, tx, {
        statusIn: ['pending'],
      });
      if (!activated) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
      await this.audit.record(
        {
          action: 'platformAdmin.activate',
          resourceType: 'platformAdmin',
          resourceId: admin.id,
          actorId: admin.id,
          actorEmail: admin.email,
        },
        tx,
      );
    });
    this.userCache.invalidate(admin.id);
    this.changed(admin.id);
    return { success: true };
  }

  /** 重設密碼：順帶解鎖，並結束所有既存的 session。停用的帳號不能靠重設密碼復活。 */
  async resetPassword(raw: string, password: string): Promise<{ success: true }> {
    const token = await this.tokens.findUsable(raw, 'password_reset');
    const admin = token && (await this.repo.findById(token.adminId));
    if (!token || !admin || admin.status === 'inactive' || admin.status === 'pending') {
      throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    }
    const passwordHash = await hashPassword(password);
    await withTransaction(this.db, async (tx) => {
      if (!(await this.tokens.markUsed(token.id, tx))) {
        throw new AppException('AUTH_SETUP_TOKEN_INVALID');
      }
      // 讀到之後才被停用（或刪除）的人不能被改回 active：狀態在寫入時再確認一次
      // （`locked` 是舊版鎖定留下的值，平台 migration 0015 已改回 active）
      const reset = await this.repo.update(
        admin.id,
        { passwordHash, failedLoginCount: 0, lockedUntil: null, status: 'active' },
        tx,
        { statusIn: ['active', 'locked'] },
      );
      if (!reset) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
      await this.repo.incrementTokenVersion(admin.id, tx);
      await this.repo.revokeRefreshTokens(admin.id, 'password_reset', tx);
      await this.audit.record(
        {
          action: 'platformAdmin.passwordReset',
          resourceType: 'platformAdmin',
          resourceId: admin.id,
          actorId: admin.id,
          actorEmail: admin.email,
        },
        tx,
      );
    });
    this.userCache.invalidate(admin.id);
    // 其他裝置上的即時連線與 apps/platform 上的 IdP session 一起結束（docs/architecture/04-sso.md §3.5）
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      platformAdminIds: [admin.id],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
    return { success: true };
  }

  /** 改自己的顯示名稱。平台管理者沒有存在帳號上的偏好：語系、時區、主題只存在瀏覽器。 */
  async updateDisplayName(adminId: string, displayName: string): Promise<void> {
    const admin = await this.repo.findById(adminId);
    if (!admin) throw new AppException('AUTH_TOKEN_INVALID');
    if (admin.displayName === displayName) return;
    await withTransaction(this.db, async (tx) => {
      await this.repo.update(admin.id, { displayName }, tx);
      await this.audit.record(
        {
          action: 'platformAdmin.profileUpdate',
          resourceType: 'platformAdmin',
          resourceId: admin.id,
          actorId: admin.id,
          actorEmail: admin.email,
          metadata: { displayName: { from: admin.displayName, to: displayName } },
        },
        tx,
      );
    });
    this.userCache.invalidate(admin.id);
    this.changed(admin.id);
  }

  /**
   * 以目前的密碼換新密碼，並結束所有 session（包含發出請求的這一個），同租戶的 `/auth/change-password`。
   * 新密碼的強度由 DTO 的 `PasswordSchema` 把關；與目前的密碼相同視為太弱。
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const admin = await this.repo.findById(adminId);
    if (!admin?.passwordHash) throw new AppException('AUTH_PASSWORD_MISMATCH');
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      // 同租戶的 AuthService.changePassword：猜目前密碼的嘗試要查得到
      await this.audit.recordSafely({
        action: 'platformAdmin.passwordChange',
        resourceType: 'platformAdmin',
        resourceId: admin.id,
        result: 'failure',
        actorId: admin.id,
        actorEmail: admin.email,
        errorCode: 'AUTH_PASSWORD_MISMATCH',
      });
      throw new AppException('AUTH_PASSWORD_MISMATCH');
    }
    if (currentPassword === newPassword) throw new AppException('AUTH_PASSWORD_WEAK');

    const passwordHash = await hashPassword(newPassword);
    await withTransaction(this.db, async (tx) => {
      await this.repo.update(admin.id, { passwordHash }, tx);
      await this.repo.incrementTokenVersion(admin.id, tx);
      await this.repo.revokeRefreshTokens(admin.id, 'password_reset', tx);
      await this.audit.record(
        {
          action: 'platformAdmin.passwordChange',
          resourceType: 'platformAdmin',
          resourceId: admin.id,
          actorId: admin.id,
          actorEmail: admin.email,
        },
        tx,
      );
    });
    this.userCache.invalidate(admin.id);
    // 其他裝置上的即時連線與 IdP session 一起結束（docs/architecture/backend/08-realtime.md §3.6、04-sso.md §3.5）
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      platformAdminIds: [admin.id],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
    return { success: true };
  }

  /** 推給 apps/platform 上的平台管理者（docs/architecture/backend/08-realtime.md §3.6）：管理者清單跟著更新。 */
  private changed(adminId: string): void {
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_ADMIN, kind: ChangeKind.UPDATE, id: adminId }],
    });
  }
}
