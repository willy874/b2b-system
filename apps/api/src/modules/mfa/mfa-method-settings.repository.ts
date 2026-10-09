import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import { mfaMethodSettings } from '@/db/platform/schema';
import type { MfaMethodSettingsRow } from '@/db/platform/schema';

/** 平台 DB 的 MFA 方式參數（docs/architecture/backend/21-mfa.md §5.1）。 */
@Injectable()
export class MfaMethodSettingsRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  list(): Promise<MfaMethodSettingsRow[]> {
    return this.db.select().from(mfaMethodSettings);
  }

  async find(
    method: string,
    tx: PlatformDbOrTx = this.db,
  ): Promise<MfaMethodSettingsRow | undefined> {
    const [row] = await tx
      .select()
      .from(mfaMethodSettings)
      .where(eq(mfaMethodSettings.method, method));
    return row;
  }

  /**
   * 寫入；`expectedVersion` 是讀到的版本（第一次建立時是 null）。版本不符回 false（樂觀鎖），由呼叫端回 409。
   */
  async save(
    method: string,
    input: { values: Record<string, string>; secretsEncrypted: string | null; updatedBy: string },
    expectedVersion: number | null,
    tx: PlatformDbOrTx = this.db,
  ): Promise<boolean> {
    if (expectedVersion === null) {
      const inserted = await tx
        .insert(mfaMethodSettings)
        .values({ method, ...input })
        .onConflictDoNothing()
        .returning({ method: mfaMethodSettings.method });
      return inserted.length > 0;
    }
    const updated = await tx
      .update(mfaMethodSettings)
      .set({ ...input, version: sql`${mfaMethodSettings.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(eq(mfaMethodSettings.method, method), eq(mfaMethodSettings.version, expectedVersion)),
      )
      .returning({ method: mfaMethodSettings.method });
    return updated.length > 0;
  }

  async delete(method: string, tx: PlatformDbOrTx = this.db): Promise<void> {
    await tx.delete(mfaMethodSettings).where(eq(mfaMethodSettings.method, method));
  }
}
