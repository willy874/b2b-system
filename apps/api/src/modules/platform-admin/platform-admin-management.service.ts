import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
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

function toDto(admin: PlatformAdminRow): PlatformAdminDto {
  return {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

/**
 * 平台管理者的管理（docs/architecture/05-tenancy.md §10.2 D5；`platformAdmin:*` 只有 super-admin 有）。
 * 規則同租戶的使用者管理：不接受密碼（一律寄設定密碼的連結）、不能改自己的角色與狀態、
 * 不能讓最後一位 `active` 的 super-admin 消失；停用即撤銷 session。
 */
@Injectable()
export class PlatformAdminManagementService {
  constructor(
    private readonly repo: PlatformAdminRepository,
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
    const admin = await this.repo.create(dto).catch((error: unknown) => {
      // 同時建立同一個 email：唯一索引擋下
      if ((error as { code?: string }).code === '23505') {
        throw new AppException('USER_EMAIL_DUPLICATE');
      }
      throw error;
    });
    await this.audit.record({
      action: 'platformAdmin.create',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      metadata: { email: admin.email, role: admin.role },
    });
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
    if ((roleChanged || statusChanged) && actor.id === id) {
      throw new AppException('AUTHZ_SELF_MODIFY');
    }
    // 只有 active 的 super-admin 能管理平台管理者，而且不能改自己：經 API 時一定還有另一位（執行者本人）。
    // 仍然檢查——之後若開放別的角色管理管理者，這條規則不能靠呼叫端記得
    const losesSuperAdmin =
      admin.role === 'super-admin' &&
      admin.status === 'active' &&
      ((roleChanged && dto.role !== 'super-admin') || nextStatus !== 'active');
    if (losesSuperAdmin && (await this.repo.countActiveSuperAdmins(id)) < 1) {
      throw new AppException('LAST_SUPER_ADMIN');
    }

    const patch = {
      displayName: dto.displayName,
      role: dto.role,
      status: nextStatus,
      // 解鎖：同時清掉失敗計數
      ...(admin.status === 'locked' && nextStatus === 'active'
        ? { failedLoginCount: 0, lockedUntil: null }
        : {}),
    };
    if (statusChanged && nextStatus === 'inactive') {
      await this.repo.updateAndEndSessions(id, patch, 'user_disabled');
    } else {
      await this.repo.update(id, patch);
    }
    this.userCache.invalidate(id);

    await this.audit.record({
      action: 'platformAdmin.update',
      resourceType: 'platformAdmin',
      resourceId: id,
      metadata: {
        email: admin.email,
        before: { displayName: admin.displayName, role: admin.role, status: admin.status },
        after: {
          displayName: dto.displayName ?? admin.displayName,
          role: dto.role ?? admin.role,
          status: nextStatus,
        },
      },
    });
    this.changed(ChangeKind.UPDATE, id);
    // 停用：這個人在 apps/platform 上的即時連線一起斷掉（docs/architecture/backend/08-realtime.md §3.6）
    if (statusChanged && nextStatus === 'inactive') {
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

  /** 還沒啟用的人只能靠啟用信變成 `active`；其他狀態依要求改（`locked` → `active` 即解鎖）。 */
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
