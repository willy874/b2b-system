import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import { isActiveRole, mfaPolicy, roles } from '@/db/schema';
import type { MfaPolicyRow } from '@/db/schema';

export interface MfaPolicyValues {
  requireAll: boolean;
  requiredRoleIds: string[];
  allowedMethods: string[] | null;
}

/** 租戶的 MFA 政策（一列，docs/architecture/backend/21-mfa.md §6）。 */
@Injectable()
export class MfaPolicyRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async find(tx: DbOrTx = this.db): Promise<MfaPolicyRow | undefined> {
    const [row] = await tx.select().from(mfaPolicy).where(eq(mfaPolicy.key, 'default')).limit(1);
    return row;
  }

  /**
   * 樂觀鎖的寫入：`version` 與目前的相同時才寫（還沒有列時 `version` 是 1，第一次寫入建立它）。回傳寫入後的列，衝突時 undefined。
   */
  async save(
    values: MfaPolicyValues,
    version: number,
    updatedBy: string,
    tx: DbOrTx = this.db,
  ): Promise<MfaPolicyRow | undefined> {
    const now = new Date();
    if (version === 1) {
      const [inserted] = await tx
        .insert(mfaPolicy)
        .values({ key: 'default', ...values, version: 2, updatedBy, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
    }
    const [row] = await tx
      .update(mfaPolicy)
      .set({ ...values, version: sql`${mfaPolicy.version} + 1`, updatedBy, updatedAt: now })
      .where(and(eq(mfaPolicy.key, 'default'), eq(mfaPolicy.version, version)))
      .returning();
    return row;
  }

  /** 未刪除的角色（政策讀取時濾掉已刪除的角色）。 */
  async existingRoleIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, [...ids]), isActiveRole()));
    return new Set(rows.map((row) => row.id));
  }
}
