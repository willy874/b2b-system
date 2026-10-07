import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { platformAdminLoginSources } from '@/db/platform/schema';
import { LOGIN_SOURCE_RETENTION_DAYS } from '@/modules/credential/login-source.service';

/** 平台管理者登入成功過的來源（平台 DB）；規則與租戶的 `LoginSourceService` 相同（docs/architecture/backend/04-auth.md §3.4）。 */
@Injectable()
export class PlatformAdminLoginSourceRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async isKnown(adminId: string, ipPrefix: string): Promise<boolean> {
    const [row] = await this.db
      .select({ adminId: platformAdminLoginSources.adminId })
      .from(platformAdminLoginSources)
      .where(
        and(
          eq(platformAdminLoginSources.adminId, adminId),
          eq(platformAdminLoginSources.ipPrefix, ipPrefix),
          sql`${platformAdminLoginSources.lastSuccessAt} > now() - make_interval(days => ${LOGIN_SOURCE_RETENTION_DAYS}::int)`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async remember(adminId: string, ipPrefix: string): Promise<void> {
    await this.db
      .insert(platformAdminLoginSources)
      .values({ adminId, ipPrefix })
      .onConflictDoUpdate({
        target: [platformAdminLoginSources.adminId, platformAdminLoginSources.ipPrefix],
        set: { lastSuccessAt: sql`now()` },
      });
  }

  async deleteStaleBatch(batchSize: number): Promise<number> {
    const stale = this.db
      .select({
        adminId: platformAdminLoginSources.adminId,
        ipPrefix: platformAdminLoginSources.ipPrefix,
      })
      .from(platformAdminLoginSources)
      .where(
        lt(
          platformAdminLoginSources.lastSuccessAt,
          sql`now() - make_interval(days => ${LOGIN_SOURCE_RETENTION_DAYS}::int)`,
        ),
      )
      .limit(batchSize);
    const rows = await this.db
      .delete(platformAdminLoginSources)
      .where(
        sql`(${platformAdminLoginSources.adminId}, ${platformAdminLoginSources.ipPrefix}) IN (${stale})`,
      )
      .returning({ adminId: platformAdminLoginSources.adminId });
    return rows.length;
  }
}
