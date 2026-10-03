import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import type {
  PlatformAdminRole,
  PlatformNotificationLinkValue,
  PlatformNotificationRow,
} from '@/db/platform/schema';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import type { PlatformPermissionKey } from '@/db/seeds/platform-permissions';
import { deleteInBatches } from '@/modules/credential/delete-in-batches';

import type {
  ListPlatformNotificationDto,
  PlatformNotificationDto,
} from './dto/platform-notification.dto';
import {
  PLATFORM_NOTIFICATION_MAX_RETENTION_DAYS,
  PLATFORM_NOTIFICATION_READ_RETENTION_DAYS,
} from './platform-notification.constants';
import type { PlatformNotificationType } from './platform-notification.constants';
import { PlatformNotificationRepository } from './platform-notification.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlatformNotifyInput {
  type: PlatformNotificationType;
  params: Record<string, unknown>;
  link?: PlatformNotificationLinkValue;
}

function toDto(row: PlatformNotificationRow): PlatformNotificationDto {
  return {
    id: row.id,
    type: row.type,
    params: row.params,
    link: row.link ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 平台管理者的站內通知（docs/architecture/backend/15-notification.md §6.2）。發送端是平台的模組（租戶佈建、管理者管理），
 * 收件人只能看、標已讀自己的通知。寫入後推 `platformNotification` 給收件人，頂列的未讀數與列表跟著重抓。
 *
 * 通知只是提醒：寫入失敗只記錄、不讓發起的業務失敗（佈建已經完成，不能因為通知寫不進去而回報失敗）。
 */
@Injectable()
export class PlatformNotificationService {
  private readonly logger = new Logger(PlatformNotificationService.name);

  constructor(
    private readonly repo: PlatformNotificationRepository,
    private readonly events: DomainEventBus,
  ) {}

  /** 發給指定的平台管理者。 */
  async notify(recipientIds: readonly string[], input: PlatformNotifyInput): Promise<void> {
    const recipients = [...new Set(recipientIds)];
    if (!recipients.length) return;
    try {
      await this.repo.insert(
        recipients.map((recipientId) => ({
          recipientId,
          type: input.type,
          params: input.params,
          link: input.link ?? null,
        })),
      );
    } catch (error) {
      this.logger.error({ err: error, type: input.type }, '平台通知寫入失敗');
      return;
    }
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_NOTIFICATION, kind: ChangeKind.CREATE }],
      adminIds: recipients,
    });
  }

  /** 發給角色持有這個權限、目前啟用中的所有平台管理者（例：能建立租戶的人收佈建結果）。 */
  async notifyHolders(
    permission: PlatformPermissionKey,
    input: PlatformNotifyInput,
  ): Promise<void> {
    const roles = (Object.keys(PLATFORM_ROLE_PERMISSIONS) as PlatformAdminRole[]).filter((role) =>
      PLATFORM_ROLE_PERMISSIONS[role].includes(permission),
    );
    let recipients: string[];
    try {
      recipients = await this.repo.activeAdminIds(roles);
    } catch (error) {
      this.logger.error({ err: error, type: input.type }, '找不到平台通知的收件人');
      return;
    }
    await this.notify(recipients, input);
  }

  async list(
    adminId: string,
    query: ListPlatformNotificationDto,
  ): Promise<PaginatedResult<PlatformNotificationDto>> {
    const { items, total } = await this.repo.list(adminId, query);
    return paginated(items.map(toDto), total, query);
  }

  async unreadCount(adminId: string): Promise<{ count: number }> {
    return { count: await this.repo.countUnread(adminId) };
  }

  /** 已讀過的再標一次不算錯；別人的或不存在的一律 404（不透露別人的通知存在）。 */
  async markRead(adminId: string, id: string): Promise<{ success: true }> {
    if (await this.repo.markRead(adminId, id)) {
      this.changedFor(adminId);
    } else if (!(await this.repo.exists(adminId, id))) {
      throw new AppException('NOTIFICATION_NOT_FOUND');
    }
    return { success: true };
  }

  async markAllRead(adminId: string): Promise<{ updated: number }> {
    const updated = await this.repo.markAllRead(adminId);
    if (updated) this.changedFor(adminId);
    return { updated };
  }

  /** 保留清理（`platformNotification.cleanup`）。 */
  async cleanup(now = new Date()): Promise<{ deleted: number }> {
    const readBefore = new Date(now.getTime() - PLATFORM_NOTIFICATION_READ_RETENTION_DAYS * DAY_MS);
    const createdBefore = new Date(
      now.getTime() - PLATFORM_NOTIFICATION_MAX_RETENTION_DAYS * DAY_MS,
    );
    const deleted = await deleteInBatches((size) =>
      this.repo.deleteExpiredBatch(readBefore, createdBefore, size),
    );
    this.logger.log({ deleted }, '已清除過期的平台通知');
    return { deleted };
  }

  /** 自己的其他分頁（含其他裝置）同步未讀數。 */
  private changedFor(adminId: string): void {
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_NOTIFICATION, kind: ChangeKind.UPDATE }],
      adminIds: [adminId],
    });
  }
}
