import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { anyUuid, TENANT_DB } from '@/core/database';
import { watches } from '@/db/schema';

const ofResource = (resourceType: string, resourceId: string) =>
  and(eq(watches.resourceType, resourceType), eq(watches.resourceId, resourceId));

/** 關注（docs/architecture/backend/24-comment.md §2）。 */
@Injectable()
export class WatchRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async state(
    resourceType: string,
    resourceId: string,
    userId: string,
  ): Promise<{ watching: boolean; watcherCount: number }> {
    const [row] = await this.db
      .select({
        total: count(),
        mine: sql<number>`count(*) FILTER (WHERE ${watches.userId} = ${userId})`.mapWith(Number),
      })
      .from(watches)
      .where(ofResource(resourceType, resourceId));
    return { watching: (row?.mine ?? 0) > 0, watcherCount: row?.total ?? 0 };
  }

  /** 開始關注；已經在關注回 false。 */
  async watch(
    resourceType: string,
    resourceId: string,
    userId: string,
    tx?: DbOrTx,
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .insert(watches)
      .values({ resourceType, resourceId, userId })
      .onConflictDoNothing()
      .returning({ userId: watches.userId });
    return rows.length > 0;
  }

  /** 取消關注；本來就沒有關注回 false。 */
  async unwatch(resourceType: string, resourceId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(watches)
      .where(and(ofResource(resourceType, resourceId), eq(watches.userId, userId)))
      .returning({ userId: watches.userId });
    return rows.length > 0;
  }

  async watcherIds(resourceType: string, resourceId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ userId: watches.userId })
      .from(watches)
      .where(ofResource(resourceType, resourceId));
    return rows.map((row) => row.userId);
  }

  async hasWatchers(resourceType: string, resourceId: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ userId: watches.userId })
      .from(watches)
      .where(ofResource(resourceType, resourceId))
      .limit(1);
    return row !== undefined;
  }

  /** 資源永久刪除時清掉它的關注（D10）。 */
  async removeAllFor(
    resourceType: string,
    resourceIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!resourceIds.length) return;
    await tx
      .delete(watches)
      .where(and(eq(watches.resourceType, resourceType), anyUuid(watches.resourceId, resourceIds)));
  }
}
