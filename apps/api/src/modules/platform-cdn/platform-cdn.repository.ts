import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import { CDN_SETTINGS_ID } from '@/core/storage';
import type { CdnStoredOverrides } from '@/core/storage';
import { cdnSettings } from '@/db/platform/schema';
import type { CdnCheckResult, CdnSettingsRow } from '@/db/platform/schema';

/** 寫入的內容：覆寫值，與 `state` 有變時的「誰在何時切換」。 */
export interface CdnSettingsWrite extends CdnStoredOverrides {
  stateChangedAt: Date | null;
  stateChangedBy: string | null;
  updatedBy: string;
}

/** 平台 DB 的 `cdn_settings`（docs/architecture/backend/09-file.md §16.9）；讀取的快取在 `core/storage` 的 `CdnSettings`。 */
@Injectable()
export class PlatformCdnRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async find(tx: PlatformDbOrTx = this.db): Promise<CdnSettingsRow | undefined> {
    const [row] = await tx
      .select()
      .from(cdnSettings)
      .where(eq(cdnSettings.id, CDN_SETTINGS_ID))
      .limit(1);
    return row;
  }

  /**
   * 樂觀鎖的寫入：`version` 與目前的相同時才寫（還沒有列時 `version` 是 1，第一次寫入建立它；與 MFA 政策相同）。
   * 回傳寫入後的列，衝突時 undefined。
   */
  async save(
    values: CdnSettingsWrite,
    version: number,
    tx: PlatformDbOrTx = this.db,
  ): Promise<CdnSettingsRow | undefined> {
    const now = new Date();
    if (version === 1) {
      const [inserted] = await tx
        .insert(cdnSettings)
        .values({ id: CDN_SETTINGS_ID, ...values, version: 2, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
    }
    const [row] = await tx
      .update(cdnSettings)
      .set({ ...values, version: sql`${cdnSettings.version} + 1`, updatedAt: now })
      .where(and(eq(cdnSettings.id, CDN_SETTINGS_ID), eq(cdnSettings.version, version)))
      .returning();
    return row;
  }

  /** 檢查的結果：不是設定的變更，不遞增 `version`；還沒有列時建立一列（覆寫值全部是 null，等於沒有列）。 */
  async saveCheck(result: CdnCheckResult): Promise<void> {
    const checkedAt = new Date(result.checkedAt);
    await this.db
      .insert(cdnSettings)
      .values({ id: CDN_SETTINGS_ID, lastCheckAt: checkedAt, lastCheck: result })
      .onConflictDoUpdate({
        target: cdnSettings.id,
        set: { lastCheckAt: checkedAt, lastCheck: result },
      });
  }
}
