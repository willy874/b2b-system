import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import type { PlatformAdminRow } from '@/db/platform/schema';
import {
  PlatformNotificationRoute,
  PlatformNotificationType,
} from '@/modules/platform-notification/platform-notification.constants';
import { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';

import type {
  CreatePlatformAdminDto,
  PlatformAdminDto,
  PlatformAdminListDto,
  UpdatePlatformAdminDto,
} from './dto/platform-admin.dto';
import { PLATFORM_ACCOUNT_MAIL_JOB } from './platform-admin.constants';
import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthTokenRepository } from './platform-auth-token.repository';

/** 登入失敗鎖定中（`locked_until` 未到期）。鎖定不改 `status`（docs/architecture/backend/04-auth.md §3.3）。 */
function isLoginLocked(admin: PlatformAdminRow): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now();
}

/** 對外顯示的狀態：`active` 而鎖定中時是 `locked`（同租戶的 `displayStatusOf`），管理介面據此顯示與解鎖。 */
function displayStatusOf(admin: PlatformAdminRow): PlatformAdminRow['status'] {
  return admin.status === 'active' && isLoginLocked(admin) ? 'locked' : admin.status;
}

function toDto(admin: PlatformAdminRow): PlatformAdminDto {
  return {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    status: displayStatusOf(admin),
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

/**
 * 平台管理者的管理（docs/architecture/05-tenancy.md §10.2 D5；`platformAdmin:*` 只有 super-admin 有）。
 * 規則同租戶的使用者管理：不接受密碼（一律寄設定密碼的連結）、不能改自己的角色與狀態、
 * 不能讓最後一位 `active` 的 super-admin 消失；停用即撤銷 session 與已寄出的連結。
 * 寫入與稽核在同一個交易；快取失效、事件、通知、寄信在提交之後（CLAUDE.md 後端規則 6）。
 */
@Injectable()
export class PlatformAdminManagementService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly repo: PlatformAdminRepository,
    private readonly tokens: PlatformAuthTokenRepository,
    private readonly audit: PlatformAuditService,
    private readonly jobs: JobQueue,
    private readonly userCache: UserCacheService,
    private readonly events: DomainEventBus,
    private readonly notifications: PlatformNotificationService,
  ) {}

  async list(): Promise<PlatformAdminListDto> {
    return { items: (await this.repo.list()).map(toDto) };
  }

  async create(dto: CreatePlatformAdminDto): Promise<PlatformAdminDto> {
    if (await this.repo.findByEmail(dto.email)) throw new AppException('USER_EMAIL_DUPLICATE');
    const admin = await withTransaction(this.db, async (tx) => {
      const created = await this.repo.create(dto, tx);
      await this.audit.record(
        {
          action: 'platformAdmin.create',
          resourceType: 'platformAdmin',
          resourceId: created.id,
          metadata: { email: created.email, role: created.role },
        },
        tx,
      );
      return created;
    }).catch((error: unknown) => {
      // 同時建立同一個 email：唯一索引擋下
      if (isUniqueViolation(error)) throw new AppException('USER_EMAIL_DUPLICATE');
      throw error;
    });
    // 平台工作不能在交易裡入列：提交之後才寄。入列失敗時管理介面的「寄設定密碼的連結」可以補寄
    await this.jobs.enqueue(PLATFORM_ACCOUNT_MAIL_JOB, {
      adminId: admin.id,
      purpose: 'activation',
    });
    this.changed(ChangeKind.CREATE, admin.id);
    return toDto(admin);
  }

  async update(
    id: string,
    dto: UpdatePlatformAdminDto,
    actor: AuthUser,
  ): Promise<PlatformAdminDto> {
    const admin = await this.getExisting(id);
    const roleChanged = dto.role !== undefined && dto.role !== admin.role;
    const nextStatus = this.nextStatus(admin, dto.status);
    const statusChanged = nextStatus !== admin.status;
    // 顯示為 locked 的人改成 active＝解鎖：清掉失敗計數與鎖定到期時間（status 本來就是 active）
    const unlocking = dto.status === 'active' && displayStatusOf(admin) === 'locked';
    const deactivating = statusChanged && nextStatus === 'inactive';
    if ((roleChanged || statusChanged) && actor.id === id) {
      throw new AppException('AUTHZ_SELF_MODIFY');
    }
    const losesSuperAdmin =
      admin.role === 'super-admin' &&
      admin.status === 'active' &&
      ((roleChanged && dto.role !== 'super-admin') || nextStatus !== 'active');

    await withTransaction(this.db, async (tx) => {
      // 「最後一位 super-admin」：鎖 → 計數 → 寫入在同一個交易，兩位 super-admin 同時互相降級時只有一個成功
      // （docs/architecture/backend/05-rbac.md §8.2）
      if (losesSuperAdmin) {
        await this.repo.lockSuperAdminGuard(tx);
        if ((await this.repo.countActiveSuperAdmins(id, tx)) < 1) {
          throw new AppException('LAST_SUPER_ADMIN');
        }
      }
      await this.repo.update(
        id,
        {
          displayName: dto.displayName,
          role: dto.role,
          status: nextStatus,
          ...(unlocking ? { failedLoginCount: 0, lockedUntil: null } : {}),
        },
        tx,
      );
      if (deactivating) {
        // 停用：既存的 access token 失效、refresh token 撤銷，已寄出還沒用的啟用與重設連結一併作廢
        await this.repo.incrementTokenVersion(id, tx);
        await this.repo.revokeRefreshTokens(id, 'user_disabled', tx);
        await this.tokens.revokeUnused(id, tx);
      }
      await this.audit.record(
        {
          action: 'platformAdmin.update',
          resourceType: 'platformAdmin',
          resourceId: id,
          metadata: {
            email: admin.email,
            before: {
              displayName: admin.displayName,
              role: admin.role,
              status: displayStatusOf(admin),
            },
            after: {
              displayName: dto.displayName ?? admin.displayName,
              role: dto.role ?? admin.role,
              status: nextStatus,
            },
          },
        },
        tx,
      );
    });
    this.userCache.invalidate(id);
    this.changed(ChangeKind.UPDATE, id);
    // 停用：這個人在 apps/platform 上的即時連線與 IdP session 一起結束（docs/architecture/backend/08-realtime.md §3.6）
    if (deactivating) {
      this.events.publish(DomainEvent.SESSIONS_REVOKED, {
        platformAdminIds: [id],
        reason: SessionRevokedReason.ACCOUNT_DISABLED,
      });
    }
    if (roleChanged && dto.role) {
      await this.notifications.notify([id], {
        type: PlatformNotificationType.PLATFORM_ADMIN_ROLE_CHANGED,
        params: { from: admin.role, to: dto.role },
        link: { route: PlatformNotificationRoute.PROFILE, params: {} },
      });
    }
    return toDto(await this.getExisting(id));
  }

  /** 寄設定密碼的連結：還沒啟用的寄啟用信，其他人寄重設密碼信（忘記密碼由其他平台管理者代為處理）。 */
  async sendPasswordLink(id: string): Promise<{ purpose: 'activation' | 'passwordReset' }> {
    const admin = await this.getExisting(id);
    const purpose = admin.status === 'pending' ? 'activation' : 'passwordReset';
    await this.jobs.enqueue(PLATFORM_ACCOUNT_MAIL_JOB, { adminId: id, purpose });
    await this.audit.record({
      action: 'platformAdmin.sendPasswordLink',
      resourceType: 'platformAdmin',
      resourceId: id,
      metadata: { email: admin.email, purpose },
    });
    return { purpose };
  }

  /** 推給 apps/platform 上的平台管理者（docs/architecture/backend/08-realtime.md §3.6）。 */
  private changed(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_ADMIN, kind, id }],
    });
  }

  private async getExisting(id: string): Promise<PlatformAdminRow> {
    const admin = await this.repo.findById(id);
    if (!admin) throw new AppException('PLATFORM_ADMIN_NOT_FOUND');
    return admin;
  }

  /** 還沒啟用的人只能靠啟用信變成 `active`；其他狀態依要求改（鎖定中改成 `active` 即解鎖，見 `update`）。 */
  private nextStatus(
    admin: PlatformAdminRow,
    requested: 'active' | 'inactive' | undefined,
  ): PlatformAdminRow['status'] {
    if (!requested || requested === admin.status) return admin.status;
    if (admin.status === 'pending')
      throw new AppException('VALIDATION_FAILED', { field: 'status' });
    return requested;
  }
}
