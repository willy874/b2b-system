import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { userLoginSources } from '@/db/schema';

/** 已知來源的保留天數：超過就當作陌生來源（docs/architecture/backend/04-auth.md §3.4）。 */
export const LOGIN_SOURCE_RETENTION_DAYS = 30;

/**
 * 登入成功過的來源（使用者 × IP 前綴）：從已知來源打錯密碼不累計帳號鎖定，只受漸進延遲限制
 * （docs/architecture/backend/04-auth.md §3.4）。
 */
@Injectable()
export class LoginSourceService {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async isKnown(userId: string, ipPrefix: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: userLoginSources.userId })
      .from(userLoginSources)
      .where(
        and(
          eq(userLoginSources.userId, userId),
          eq(userLoginSources.ipPrefix, ipPrefix),
          sql`${userLoginSources.lastSuccessAt} > now() - make_interval(days => ${LOGIN_SOURCE_RETENTION_DAYS}::int)`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async remember(userId: string, ipPrefix: string): Promise<void> {
    await this.db
      .insert(userLoginSources)
      .values({ userId, ipPrefix })
      .onConflictDoUpdate({
        target: [userLoginSources.userId, userLoginSources.ipPrefix],
        set: { lastSuccessAt: sql`now()` },
      });
  }

  /** 過期的來源（每天的 `auth.tokenCleanup` 分批清除）。 */
  async deleteStaleBatch(batchSize: number): Promise<number> {
    const stale = this.db
      .select({ userId: userLoginSources.userId, ipPrefix: userLoginSources.ipPrefix })
      .from(userLoginSources)
      .where(
        lt(
          userLoginSources.lastSuccessAt,
          sql`now() - make_interval(days => ${LOGIN_SOURCE_RETENTION_DAYS}::int)`,
        ),
      )
      .limit(batchSize);
    const rows = await this.db
      .delete(userLoginSources)
      .where(sql`(${userLoginSources.userId}, ${userLoginSources.ipPrefix}) IN (${stale})`)
      .returning({ userId: userLoginSources.userId });
    return rows.length;
  }
}
