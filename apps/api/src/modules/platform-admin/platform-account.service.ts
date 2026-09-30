import { Injectable } from '@nestjs/common';

import { UserCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import { hashPassword } from '@/modules/credential/password';

import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthTokenRepository } from './platform-auth-token.repository';

/**
 * 平台管理者從信中連結設定密碼（啟用、重設；同租戶的 `/auth/setup`、`/auth/reset-password`）。
 * token 無效、過期、用過一律 `AUTH_SETUP_TOKEN_INVALID`，不區分原因。
 */
@Injectable()
export class PlatformAccountService {
  constructor(
    private readonly repo: PlatformAdminRepository,
    private readonly tokens: PlatformAuthTokenRepository,
    private readonly audit: PlatformAuditService,
    private readonly userCache: UserCacheService,
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
}
