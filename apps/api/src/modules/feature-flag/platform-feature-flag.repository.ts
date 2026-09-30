import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformTransaction } from '@/core/database';
import type { FeatureFlagGlobalState } from '@/core/feature-flags';
import { featureFlagOverrides, tenants } from '@/db/platform/schema';

/** 全平台層覆寫的寫入與租戶覆寫的統計（平台 DB，docs/adr/0022-feature-flags.md D2、D8）。 */
@Injectable()
export class PlatformFeatureFlagRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  transaction<T>(fn: (tx: PlatformTransaction) => Promise<T>): Promise<T> {
    return withTransaction(this.db, fn);
  }

  /** 交易內讀取並鎖住（`FOR UPDATE`）：同一個 flag 的切換依序進行，稽核的 before 才是實際被取代的值。 */
  async findGlobalForUpdate(
    key: string,
    tx: PlatformTransaction,
  ): Promise<FeatureFlagGlobalState | undefined> {
    const [row] = await tx
      .select({ state: featureFlagOverrides.state })
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.key, key))
      .for('update');
    return row?.state;
  }

  async setGlobal(
    key: string,
    state: FeatureFlagGlobalState,
    updatedBy: string,
    tx: PlatformTransaction,
  ): Promise<void> {
    await tx
      .insert(featureFlagOverrides)
      .values({ key, state, updatedBy })
      .onConflictDoUpdate({
        target: featureFlagOverrides.key,
        set: { state, updatedBy, updatedAt: sql`now()` },
      });
  }

  async clearGlobal(key: string, tx: PlatformTransaction): Promise<void> {
    await tx.delete(featureFlagOverrides).where(eq(featureFlagOverrides.key, key));
  }

  /** 每個 key 被租戶覆寫成開、關的租戶數（未刪除的租戶；非布林的值不算）。 */
  async countTenantOverrides(): Promise<Array<{ key: string; enabled: boolean; count: number }>> {
    return this.db.execute<{ key: string; enabled: boolean; count: number }>(sql`
      SELECT f.key, f.value::boolean AS enabled, count(*)::int AS count
      FROM ${tenants}, jsonb_each(${tenants.flags}) AS f(key, value)
      WHERE ${tenants.deletedAt} IS NULL AND jsonb_typeof(f.value) = 'boolean'
      GROUP BY f.key, f.value
    `);
  }
}
