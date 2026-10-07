import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { PermissionService } from '@/modules/permission/permission.service';

import type { MfaAccountStatusDto } from './dto/mfa.dto';
import { MfaService } from './mfa.service';

/**
 * 管理員檢視與重設他人的 MFA（docs/architecture/backend/21-mfa.md §8）。重設會結束對方所有的 session。
 */
@Injectable()
export class MfaAdminService {
  constructor(
    private readonly mfa: MfaService,
    private readonly permissions: PermissionService,
  ) {}

  userStatus(userId: string): Promise<MfaAccountStatusDto> {
    return this.mfa.status('tenant', userId);
  }

  /**
   * 反提權：目標持有 super-admin（含經由群組）時，操作者也必須持有 super-admin——否則 admin 可以拆掉 super-admin 的 MFA，
   * 再配合外洩的密碼登入（與服務帳號的規則相同，docs/architecture/backend/04-auth.md §8.2）。
   */
  async resetUser(actor: AuthUser, userId: string): Promise<{ success: true }> {
    if (actor.id === userId) throw new AppException('AUTHZ_SELF_MODIFY');
    await this.mfa.requireAccount(this.mfa.store('tenant'), userId);
    const [target, self] = await Promise.all([
      this.permissions.getPermissionSet(userId),
      this.permissions.getPermissionSet(actor.id),
    ]);
    if (target.isSuperAdmin && !self.isSuperAdmin) {
      throw new AppException('AUTHZ_ESCALATION', { role: 'super-admin', target: userId });
    }
    return this.mfa.reset('tenant', actor, userId);
  }

  platformAdminStatus(adminId: string): Promise<MfaAccountStatusDto> {
    return this.mfa.status('platform', adminId);
  }

  /** 平台管理者：不能重設自己（與其他自我修改相同）；平台的權限由角色決定，`platformAdmin:resetMfa` 已足夠。 */
  resetPlatformAdmin(actor: AuthUser, adminId: string): Promise<{ success: true }> {
    if (actor.id === adminId) throw new AppException('AUTHZ_SELF_MODIFY');
    return this.mfa.reset('platform', actor, adminId);
  }
}
