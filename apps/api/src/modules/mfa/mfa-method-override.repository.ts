import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import { mfaMethodOverrides, mfaMethodStats, notDeleted, tenants } from '@/db/platform/schema';
import type { MfaMethodOverrideRow, MfaMethodStatsRow } from '@/db/platform/schema';

/** 平台 DB 的 MFA 方式開關與統計（docs/architecture/backend/21-mfa.md §5）。 */
@Injectable()
export class MfaMethodOverrideRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  listGlobal(): Promise<MfaMethodOverrideRow[]> {
    return this.db.select().from(mfaMethodOverrides);
  }

  async setGlobal(
    method: string,
    state: 'on' | 'off' | null,
    updatedBy: string,
    tx: PlatformDbOrTx = this.db,
  ): Promise<void> {
    if (state === null) {
      await tx.delete(mfaMethodOverrides).where(eq(mfaMethodOverrides.method, method));
      return;
    }
    await tx
      .insert(mfaMethodOverrides)
      .values({ method, state, updatedBy })
      .onConflictDoUpdate({
        target: mfaMethodOverrides.method,
        set: { state, updatedBy, updatedAt: sql`now()` },
      });
  }

  /** 每個方式被租戶覆寫成開／關的租戶數（未刪除的租戶）。 */
  async countTenantOverrides(): Promise<Map<string, { on: number; off: number }>> {
    const rows = await this.db.execute<{ method: string; on: number; off: number }>(sql`
      SELECT key AS method,
             count(*) FILTER (WHERE value = 'true'::jsonb)::int AS on,
             count(*) FILTER (WHERE value = 'false'::jsonb)::int AS off
      FROM ${tenants}, jsonb_each(${tenants.mfaMethods})
      WHERE ${notDeleted(tenants)}
      GROUP BY key`);
    return new Map(rows.map((row) => [row.method, { on: row.on, off: row.off }]));
  }

  listStats(): Promise<MfaMethodStatsRow[]> {
    return this.db.select().from(mfaMethodStats);
  }

  async replaceStats(rows: ReadonlyArray<Omit<MfaMethodStatsRow, 'computedAt'>>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(mfaMethodStats);
      if (rows.length) await tx.insert(mfaMethodStats).values([...rows]);
    });
  }
}
