import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import { UserCacheService } from '@/core/cache';
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
 */
@Injectable()
export class PlatformAccountService {
  constructor(
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
    await this.repo.update(admin.id, {
      passwordHash: await hashPassword(password),
      status: 'active',
    });
    await this.tokens.markUsed(token.id);
    this.userCache.invalidate(admin.id);
    await this.audit.record({
      action: 'platformAdmin.activate',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
    });
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
    await this.repo.updateAndEndSessions(
      admin.id,
      {
        passwordHash: await hashPassword(password),
        failedLoginCount: 0,
        lockedUntil: null,
        status: 'active',
      },
      'password_reset',
    );
    await this.tokens.markUsed(token.id);
    this.userCache.invalidate(admin.id);
    await this.audit.record({
      action: 'platformAdmin.passwordReset',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
    });
    return { success: true };
  }

  /** 改自己的顯示名稱。平台管理者沒有存在帳號上的偏好：語系、時區、主題只存在瀏覽器。 */
  async updateDisplayName(adminId: string, displayName: string): Promise<void> {
    const admin = await this.repo.findById(adminId);
    if (!admin) throw new AppException('AUTH_TOKEN_INVALID');
    if (admin.displayName === displayName) return;
    await this.repo.update(admin.id, { displayName });
    this.userCache.invalidate(admin.id);
    await this.audit.record({
      action: 'platformAdmin.profileUpdate',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
      metadata: { displayName: { from: admin.displayName, to: displayName } },
    });
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
      throw new AppException('AUTH_PASSWORD_MISMATCH');
    }
    if (currentPassword === newPassword) throw new AppException('AUTH_PASSWORD_WEAK');

    await this.repo.updateAndEndSessions(
      admin.id,
      { passwordHash: await hashPassword(newPassword) },
      'password_reset',
    );
    this.userCache.invalidate(admin.id);
    await this.audit.record({
      action: 'platformAdmin.passwordChange',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
    });
    // 其他裝置上的即時連線一起斷掉（docs/architecture/backend/08-realtime.md §3.6）
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
