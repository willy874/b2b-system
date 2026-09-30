import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import type { PlatformPermissionKey } from '@/db/seeds/platform-permissions';
import { verifyAgainstDummy, verifyPassword } from '@/modules/credential/password';

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

    // 狀態與鎖定在驗證密碼之後才判斷：不知道密碼的人只看得到 AUTH_INVALID_CREDENTIALS（不能藉此列舉帳號）
    const ok = admin.passwordHash
      ? await verifyPassword(admin.passwordHash, dto.password)
      : await verifyAgainstDummy(dto.password);
    const lockedUntil =
      admin.lockedUntil && admin.lockedUntil.getTime() > Date.now() ? admin.lockedUntil : null;
    if (!ok) {
      // 鎖定中不計數、不延長鎖定
      if (!lockedUntil) await this.registerFailedAttempt(admin);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    if (lockedUntil) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        retryAfterSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
      });
    }
    if (admin.status === 'inactive') throw new AppException('AUTH_ACCOUNT_DISABLED');
    // 由其他平台管理者建立、還沒從啟用信設定密碼
    if (admin.status === 'pending') throw new AppException('AUTH_ACCOUNT_PENDING');

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

  /** 可以登入的平台管理者的權限（依角色）；不存在或不是 `active` 時是空集合。 */
  async permissionsOf(id: string): Promise<ReadonlySet<PlatformPermissionKey>> {
    const admin = await this.findActive(id);
    return new Set(admin ? PLATFORM_ROLE_PERMISSIONS[admin.role] : []);
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    return this.repo.findById(id);
  }

  /** 原子遞增失敗次數（併發的錯誤密碼每一次都算數）；上一次鎖定到期後從 1 重新計算。 */
  private async registerFailedAttempt(admin: PlatformAdminRow): Promise<void> {
    const result = await this.repo.recordFailedLogin(
      admin.id,
      this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true }),
      this.config.get('LOGIN_LOCKOUT_SECONDS', { infer: true }),
    );
    // 並行的另一個失敗剛好鎖上了：這一次不再計數
    if (!result) return;
    const shouldLock = result.lockedUntil !== null;
    const count = result.failedLoginCount;
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
