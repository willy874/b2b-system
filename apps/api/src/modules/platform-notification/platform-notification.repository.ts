import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import type { PlatformAdminRole, PlatformNotificationLinkValue } from '@/db/platform/schema';
import { notDeleted, platformAdmins, platformNotifications } from '@/db/platform/schema';
import type { PlatformNotificationRow } from '@/db/platform/schema';

export interface PlatformNotificationInsert {
  recipientId: string;
  type: string;
  params: Record<string, unknown>;
  link: PlatformNotificationLinkValue | null;
}

/** 平台管理者的站內通知（平台 DB，docs/architecture/backend/15-notification.md §6.2）。 */
@Injectable()
export class PlatformNotificationRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async insert(rows: readonly PlatformNotificationInsert[]): Promise<void> {
    if (!rows.length) return;
    await this.db.insert(platformNotifications).values([...rows]);
  }

  /** 這些角色裡、目前啟用中的平台管理者。 */
  async activeAdminIds(roles: readonly PlatformAdminRole[]): Promise<string[]> {
    if (!roles.length) return [];
    const rows = await this.db
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(
        and(
          inArray(platformAdmins.role, [...roles]),
          eq(platformAdmins.status, 'active'),
          notDeleted(platformAdmins),
        ),
      );
    return rows.map((row) => row.id);
  }

  async list(
    recipientId: string,
    { offset, limit, unread }: { offset: number; limit: number; unread: boolean },
  ): Promise<{ items: PlatformNotificationRow[]; total: number }> {
    const where = and(
      eq(platformNotifications.recipientId, recipientId),
      unread ? isNull(platformNotifications.readAt) : undefined,
    );
    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(platformNotifications)
        .where(where)
        .orderBy(desc(platformNotifications.createdAt), desc(platformNotifications.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(platformNotifications).where(where),
    ]);
    return { items, total: total?.total ?? 0 };
  }

  async countUnread(recipientId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(platformNotifications)
      .where(
        and(
          eq(platformNotifications.recipientId, recipientId),
          isNull(platformNotifications.readAt),
        ),
      );
    return row?.total ?? 0;
  }

  /** 回傳是否真的改了（已讀過、不是自己的、不存在都回 false）。 */
  async markRead(recipientId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(platformNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(platformNotifications.id, id),
          eq(platformNotifications.recipientId, recipientId),
          isNull(platformNotifications.readAt),
        ),
      )
      .returning({ id: platformNotifications.id });
    return rows.length > 0;
  }

  async deleteOwn(recipientId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(platformNotifications)
      .where(
        and(eq(platformNotifications.id, id), eq(platformNotifications.recipientId, recipientId)),
      )
      .returning({ id: platformNotifications.id });
    return rows.length > 0;
  }

  async exists(recipientId: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: platformNotifications.id })
      .from(platformNotifications)
      .where(
        and(eq(platformNotifications.id, id), eq(platformNotifications.recipientId, recipientId)),
      )
      .limit(1);
    return Boolean(row);
  }

  async markAllRead(recipientId: string): Promise<number> {
    const rows = await this.db
      .update(platformNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(platformNotifications.recipientId, recipientId),
          isNull(platformNotifications.readAt),
        ),
      )
      .returning({ id: platformNotifications.id });
    return rows.length;
  }

  /** 已讀超過 `readBefore`、或建立早於 `createdBefore` 的通知，一批最多 `batchSize` 筆。 */
  async deleteExpiredBatch(
    readBefore: Date,
    createdBefore: Date,
    batchSize: number,
  ): Promise<number> {
    const expired = this.db
      .select({ id: platformNotifications.id })
      .from(platformNotifications)
      .where(
        or(
          and(
            isNotNull(platformNotifications.readAt),
            lt(platformNotifications.readAt, readBefore),
          ),
          lt(platformNotifications.createdAt, createdBefore),
        ),
      )
      .limit(batchSize);
    const rows = await this.db
      .delete(platformNotifications)
      .where(inArray(platformNotifications.id, sql`(${expired})`))
      .returning({ id: platformNotifications.id });
    return rows.length;
  }
}
