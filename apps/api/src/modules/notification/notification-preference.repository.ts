import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import { notificationPreferences } from '@/db/schema';
import type { NotificationPreferenceRow } from '@/db/schema';

/** 個人的通知設定覆寫值（`notification_preferences`）。 */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 一個人的所有覆寫值（最多「事件數 × 管道數」列）。 */
  async listByUser(userId: string): Promise<NotificationPreferenceRow[]> {
    return this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }

  /** 這些收件人裡，在這個事件 ＋ 管道上自己關掉的人（`notify()` 一次查完，ADR-0028 D15）。 */
  async findOptedOut(
    type: string,
    channel: string,
    userIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await (tx ?? this.db)
      .select({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.type, type),
          eq(notificationPreferences.channel, channel),
          eq(notificationPreferences.enabled, false),
          inArray(notificationPreferences.userId, [...userIds]),
        ),
      );
    return rows.map((row) => row.userId);
  }

  async upsert(
    userId: string,
    type: string,
    channel: string,
    enabled: boolean,
    tx?: DbOrTx,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(notificationPreferences)
      .values({ userId, type, channel, enabled })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.type,
          notificationPreferences.channel,
        ],
        set: { enabled: sql`excluded.enabled` },
      });
  }

  async remove(userId: string, type: string, channel: string, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, type),
          eq(notificationPreferences.channel, channel),
        ),
      );
  }
}
