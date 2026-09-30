import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { revisions, users } from '@/db/schema';

/** 列表的一列：不帶快照（可能很大），只帶是否過大未保存。 */
export interface RevisionSummaryRow {
  version: number;
  createdAt: Date;
  tooLarge: boolean;
  actor: { id: string; name: string } | null;
}

export interface RevisionDetailRow extends RevisionSummaryRow {
  snapshot: Record<string, unknown> | null;
}

const identifies = (resourceType: string, resourceId: string) =>
  and(eq(revisions.resourceType, resourceType), eq(revisions.resourceId, resourceId));

const SUMMARY_COLUMNS = {
  version: revisions.version,
  createdAt: revisions.createdAt,
  tooLarge: sql<boolean>`${revisions.snapshot} IS NULL`,
  actorId: users.id,
  actorName: users.displayName,
} as const;

function toSummary(row: {
  version: number;
  createdAt: Date;
  tooLarge: boolean;
  actorId: string | null;
  actorName: string | null;
}): RevisionSummaryRow {
  return {
    version: row.version,
    createdAt: row.createdAt,
    tooLarge: row.tooLarge,
    actor: row.actorId && row.actorName ? { id: row.actorId, name: row.actorName } : null,
  };
}

@Injectable()
export class RevisionRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 寫入下一版（`max(version) + 1`，沒有任何一版時是 1）並回傳版本號。呼叫端在同一個交易內先鎖住實體列，
   * 同一個資源的寫入依序進行；萬一沒有鎖，唯一鍵 `(resource_type, resource_id, version)` 讓後到的交易失敗而不是重號。
   */
  async insertNext(
    values: {
      resourceType: string;
      resourceId: string;
      snapshot: Record<string, unknown> | null;
      actorId: string | null;
    },
    tx: DbOrTx,
  ): Promise<number> {
    const next = sql<number>`(SELECT coalesce(max(${revisions.version}), 0) + 1 FROM ${revisions}
      WHERE ${revisions.resourceType} = ${values.resourceType} AND ${revisions.resourceId} = ${values.resourceId})`;
    const [row] = await tx
      .insert(revisions)
      .values({ ...values, version: next })
      .returning({ version: revisions.version });
    if (!row) throw new Error('寫入版本失敗');
    return row.version;
  }

  async list(
    resourceType: string,
    resourceId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: RevisionSummaryRow[]; total: number }> {
    const where = identifies(resourceType, resourceId);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select(SUMMARY_COLUMNS)
        .from(revisions)
        .leftJoin(users, eq(users.id, revisions.actorId))
        .where(where)
        .orderBy(desc(revisions.version))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(revisions)
        .where(where),
    ]);
    return { items: rows.map(toSummary), total: counted?.total ?? 0 };
  }

  async find(
    resourceType: string,
    resourceId: string,
    version: number,
  ): Promise<RevisionDetailRow | undefined> {
    const [row] = await this.db
      .select({ ...SUMMARY_COLUMNS, snapshot: revisions.snapshot })
      .from(revisions)
      .leftJoin(users, eq(users.id, revisions.actorId))
      .where(and(identifies(resourceType, resourceId), eq(revisions.version, version)))
      .limit(1);
    return row && { ...toSummary(row), snapshot: row.snapshot };
  }

  /** 刪除一個資源的所有版本（永久刪除實體時，在同一個交易內）。 */
  async deleteAll(resourceType: string, resourceId: string, tx: DbOrTx): Promise<number> {
    const rows = await tx
      .delete(revisions)
      .where(identifies(resourceType, resourceId))
      .returning({ id: revisions.id });
    return rows.length;
  }

  /**
   * 刪除一批「不在每個資源最新 `keepVersions` 版內、而且早於 `cutoff`」的版本（ADR-0025 D1）。
   * 排名以版本號倒序（最新一版是 1）；回傳這一批刪了幾筆，少於 `limit` 代表清完了。
   */
  async pruneBatch(keepVersions: number, cutoff: Date, limit: number): Promise<number> {
    const ranked = this.db
      .select({
        id: revisions.id,
        createdAt: revisions.createdAt,
        rank: sql<number>`row_number() OVER (PARTITION BY ${revisions.resourceType}, ${revisions.resourceId} ORDER BY ${revisions.version} DESC)`.as(
          'rank',
        ),
      })
      .from(revisions)
      .as('ranked');
    const expired = this.db
      .select({ id: ranked.id })
      .from(ranked)
      .where(and(gt(ranked.rank, keepVersions), lt(ranked.createdAt, cutoff)))
      .limit(limit);
    const rows = await this.db
      .delete(revisions)
      .where(inArray(revisions.id, expired))
      .returning({ id: revisions.id });
    return rows.length;
  }
}
