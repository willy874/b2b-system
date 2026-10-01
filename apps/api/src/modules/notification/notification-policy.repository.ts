import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import { notificationPolicies } from '@/db/schema';
import type { NotificationPolicyRow } from '@/db/schema';

/** 目前租戶的通知政策覆寫值（`notification_policies`）。 */
@Injectable()
export class NotificationPolicyRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 表很小（事件數 × 管道數），一次讀完整張表進快取。 */
  async listAll(tx?: DbOrTx): Promise<NotificationPolicyRow[]> {
    return (tx ?? this.db).select().from(notificationPolicies);
  }

  async upsert(
    type: string,
    channel: string,
    enabled: boolean,
    actorId: string,
    tx?: DbOrTx,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(notificationPolicies)
      .values({ type, channel, enabled, updatedBy: actorId })
      .onConflictDoUpdate({
        target: [notificationPolicies.type, notificationPolicies.channel],
        set: { enabled: sql`excluded.enabled`, updatedBy: sql`excluded.updated_by` },
      });
  }

  async remove(type: string, channel: string, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .delete(notificationPolicies)
      .where(and(eq(notificationPolicies.type, type), eq(notificationPolicies.channel, channel)));
  }
}
