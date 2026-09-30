import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import type { SystemSettingRow } from '@/db/schema';
import { systemSettings } from '@/db/schema';

import { TENANT_DB } from '../database';
import type { Database, DbOrTx } from '../database';
import type { SettingValue } from './setting-definition';

/** 目前租戶的設定覆寫值（`system_settings`）。 */
@Injectable()
export class SettingRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 表很小（一個 key 最多一列），一次讀完整張表進快取。 */
  async listAll(): Promise<SystemSettingRow[]> {
    return this.db.select().from(systemSettings);
  }

  async upsert(
    key: string,
    value: SettingValue,
    actorId: string | null,
    tx?: DbOrTx,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .insert(systemSettings)
      .values({ key, value, updatedBy: actorId })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: sql`excluded.value`, updatedBy: sql`excluded.updated_by` },
      });
  }

  async remove(key: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db.delete(systemSettings).where(eq(systemSettings.key, key));
  }
}
