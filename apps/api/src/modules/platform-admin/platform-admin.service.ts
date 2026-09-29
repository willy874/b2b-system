import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { verifyAgainstDummy, verifyPassword } from '@/modules/auth/password';

import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';

/**
 * 平台管理者的帳號（docs/adr/0020-physical-tenant-isolation.md D5、D8）：apps/auth 不帶租戶的登入互動對這裡驗證。
 * 帳密檢查的規則與租戶的 `AuthService.verifyCredentials` 相同（列舉防護、鎖定、狀態、稽核）。
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly repo: PlatformAdminRepository,
    private readonly audit: PlatformAuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async verifyCredentials(dto: { email: string; password: string }): Promise<PlatformAdminRow> {
    const admin = await this.repo.findByEmail(dto.email);
    // 時序攻擊防護：帳號不存在時也跑一次 argon2
    if (!admin) {
      await verifyAgainstDummy(dto.password);
      await this.audit.recordSafely({
        action: 'platformAuth.login.failure',
        resourceType: 'platformAuth',
        result: 'failure',
        actorEmail: dto.email,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { reason: 'admin_not_found' },
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        retryAfterSeconds: Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 1000),
      });
    }
    if (admin.status === 'inactive') throw new AppException('AUTH_ACCOUNT_DISABLED');

    const ok = admin.passwordHash ? await verifyPassword(admin.passwordHash, dto.password) : false;
    if (!ok) {
      await this.registerFailedAttempt(admin);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // 鎖定期滿後成功登入：解除鎖定
    await this.repo.update(admin.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      status: 'active',
    });
    await this.audit.recordSafely({
      action: 'platformAuth.login.success',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
    });
    return { ...admin, status: 'active' };
  }

  /** 可以登入的平台管理者（未刪除、`active`）；否則 undefined。 */
  async findActive(id: string): Promise<PlatformAdminRow | undefined> {
    const admin = await this.repo.findById(id);
    return admin?.status === 'active' ? admin : undefined;
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    return this.repo.findById(id);
  }

  private async registerFailedAttempt(admin: PlatformAdminRow): Promise<void> {
    const count = admin.failedLoginCount + 1;
    const shouldLock = count >= this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    const lockoutSeconds = this.config.get('LOGIN_LOCKOUT_SECONDS', { infer: true });
    await this.repo.update(admin.id, {
      failedLoginCount: count,
      lockedUntil: shouldLock ? new Date(Date.now() + lockoutSeconds * 1000) : null,
      status: shouldLock ? 'locked' : admin.status,
    });
    await this.audit.recordSafely({
      action: shouldLock ? 'platformAuth.account_locked' : 'platformAuth.login.failure',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      result: 'failure',
      actorId: admin.id,
      actorEmail: admin.email,
      errorCode: shouldLock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS',
      metadata: { failedLoginCount: count },
    });
  }
}
