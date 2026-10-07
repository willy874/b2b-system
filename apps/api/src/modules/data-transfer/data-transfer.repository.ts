import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import { dataTransferRows, dataTransfers, users } from '@/db/schema';
import type {
  DataTransferApplyRow,
  DataTransferApplyRowInsert,
  DataTransferInsert,
  DataTransferRow,
} from '@/db/schema';

import type { RowOutcome, TransferDirection, TransferStatus } from './data-transfer.types';

export interface TransferListQuery {
  direction?: TransferDirection;
  type?: string;
  status?: readonly TransferStatus[];
  offset: number;
  limit: number;
}

export interface TransferOwner {
  id: string;
  email: string;
  status: string;
  locale: string;
  timezone: string;
  deletedAt: Date | null;
}

export type OutcomeCounts = Readonly<Record<RowOutcome, number>>;

/** 一次寫入的套用列數：5 000 列 × 每列 6 個參數，留在 postgres 的參數上限（65 535）之內。 */
const INSERT_BATCH = 1000;

@Injectable()
export class DataTransferRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async create(values: DataTransferInsert, tx: DbOrTx): Promise<DataTransferRow> {
    const [row] = await tx.insert(dataTransfers).values(values).returning();
    if (!row) throw new Error('data_transfers 寫入沒有回傳列');
    return row;
  }

  async insertRows(rows: readonly DataTransferApplyRowInsert[], tx: DbOrTx): Promise<void> {
    for (let index = 0; index < rows.length; index += INSERT_BATCH) {
      await tx.insert(dataTransferRows).values(rows.slice(index, index + INSERT_BATCH));
    }
  }

  async findById(id: string, tx?: DbOrTx): Promise<DataTransferRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(dataTransfers)
      .where(eq(dataTransfers.id, id));
    return row;
  }

  async listByCreator(
    userId: string,
    query: TransferListQuery,
  ): Promise<{ items: DataTransferRow[]; total: number }> {
    const conditions: SQL[] = [eq(dataTransfers.createdBy, userId)];
    if (query.direction) conditions.push(eq(dataTransfers.direction, query.direction));
    if (query.type) conditions.push(eq(dataTransfers.type, query.type));
    if (query.status?.length) conditions.push(inArray(dataTransfers.status, [...query.status]));
    const where = and(...conditions);
    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(dataTransfers)
        .where(where)
        .orderBy(desc(dataTransfers.createdAt), desc(dataTransfers.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ value: count() }).from(dataTransfers).where(where),
    ]);
    return { items, total: total?.value ?? 0 };
  }

  /** 進行中的傳輸數（每人上限，§10）；在建立的交易內以 advisory lock 排隊，避免併發的建立同時通過檢查。 */
  async countActive(userId: string, tx: DbOrTx): Promise<number> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`data_transfers:${userId}`}))`);
    const [row] = await tx
      .select({ value: count() })
      .from(dataTransfers)
      .where(
        and(
          eq(dataTransfers.createdBy, userId),
          inArray(dataTransfers.status, ['queued', 'running', 'applying']),
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * 狀態轉移（條件式更新）：目前狀態在 `from` 之內（並且 `version` 相符，若有給）才更新，遞增 `version`。
   * 沒命中回 `undefined`（已被取消、已被別人轉移）。
   */
  async transition(
    id: string,
    from: readonly TransferStatus[],
    values: Partial<DataTransferInsert>,
    options: { expectedVersion?: number; tx?: DbOrTx } = {},
  ): Promise<DataTransferRow | undefined> {
    const conditions: SQL[] = [eq(dataTransfers.id, id), inArray(dataTransfers.status, [...from])];
    if (options.expectedVersion !== undefined) {
      conditions.push(eq(dataTransfers.version, options.expectedVersion));
    }
    const [row] = await (options.tx ?? this.db)
      .update(dataTransfers)
      .set({ ...values, version: sql`${dataTransfers.version} + 1`, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return row;
  }

  /** 進度（不遞增 version：只保護狀態轉移）；只在狀態仍是 `status` 時寫入，回傳目前的列。 */
  async updateProgress(
    id: string,
    status: TransferStatus,
    values: Partial<
      Pick<
        DataTransferInsert,
        'processedRows' | 'succeededRows' | 'failedRows' | 'skippedRows' | 'totalRows'
      >
    >,
  ): Promise<DataTransferRow | undefined> {
    const [row] = await this.db
      .update(dataTransfers)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(dataTransfers.id, id), eq(dataTransfers.status, status)))
      .returning();
    return row ?? this.findById(id);
  }

  /** 計數（不看狀態）：取消後仍要寫下最終的計數。 */
  async updateCounts(
    id: string,
    values: Pick<
      DataTransferInsert,
      'processedRows' | 'succeededRows' | 'failedRows' | 'skippedRows'
    >,
  ): Promise<void> {
    await this.db
      .update(dataTransfers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(dataTransfers.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(dataTransfers).where(eq(dataTransfers.id, id));
  }

  // ── 套用列 ──

  async listRows(
    transferId: string,
    options: { outcome?: readonly RowOutcome[]; afterRowNo?: number; limit: number },
    tx?: DbOrTx,
  ): Promise<DataTransferApplyRow[]> {
    const conditions: SQL[] = [eq(dataTransferRows.transferId, transferId)];
    if (options.outcome?.length) {
      conditions.push(inArray(dataTransferRows.outcome, [...options.outcome]));
    }
    if (options.afterRowNo !== undefined)
      conditions.push(gt(dataTransferRows.rowNo, options.afterRowNo));
    return (tx ?? this.db)
      .select()
      .from(dataTransferRows)
      .where(and(...conditions))
      .orderBy(asc(dataTransferRows.rowNo))
      .limit(options.limit);
  }

  async setRowOutcome(
    transferId: string,
    rowNo: number,
    values: Pick<DataTransferApplyRowInsert, 'outcome'> &
      Partial<Pick<DataTransferApplyRowInsert, 'outcomeError' | 'changes' | 'resultId'>>,
    tx?: DbOrTx,
  ): Promise<void> {
    await (tx ?? this.db)
      .update(dataTransferRows)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(dataTransferRows.transferId, transferId), eq(dataTransferRows.rowNo, rowNo)));
  }

  /** 還是 `pending` 的列一次標成某個結果（取消、權限被拿掉）。 */
  async settlePending(
    transferId: string,
    outcome: RowOutcome,
    outcomeError: Record<string, unknown> | null,
  ): Promise<void> {
    await this.db
      .update(dataTransferRows)
      .set({ outcome, outcomeError, updatedAt: new Date() })
      .where(
        and(eq(dataTransferRows.transferId, transferId), eq(dataTransferRows.outcome, 'pending')),
      );
  }

  async countOutcomes(transferId: string): Promise<OutcomeCounts> {
    const rows = await this.db
      .select({ outcome: dataTransferRows.outcome, value: count() })
      .from(dataTransferRows)
      .where(eq(dataTransferRows.transferId, transferId))
      .groupBy(dataTransferRows.outcome);
    const counts: Record<RowOutcome, number> = {
      pending: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    };
    for (const row of rows) counts[row.outcome as RowOutcome] = row.value;
    return counts;
  }

  async deleteRows(transferId: string): Promise<void> {
    await this.db.delete(dataTransferRows).where(eq(dataTransferRows.transferId, transferId));
  }

  // ── 清理 ──

  /** 保留期限已到、還沒標成 expired 的已結束傳輸（keyset 以 id）。 */
  async findExpired(now: Date, afterId: string | null, limit: number): Promise<DataTransferRow[]> {
    const conditions: SQL[] = [
      lt(dataTransfers.expiresAt, now),
      inArray(dataTransfers.status, ['completed', 'failed', 'cancelled']),
    ];
    if (afterId) conditions.push(gt(dataTransfers.id, afterId));
    return this.db
      .select()
      .from(dataTransfers)
      .where(and(...conditions))
      .orderBy(asc(dataTransfers.id))
      .limit(limit);
  }

  /** 摘要超過保留期限（從建立起算）的紀錄；一次刪一批，回傳刪除筆數。 */
  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    const rows = await this.db.execute<{ id: string }>(sql`
      DELETE FROM ${dataTransfers}
      WHERE ${dataTransfers.id} IN (
        SELECT ${dataTransfers.id} FROM ${dataTransfers}
        WHERE ${dataTransfers.createdAt} < ${cutoff.toISOString()}::timestamptz
          AND ${dataTransfers.status} NOT IN ('queued', 'running', 'applying')
        LIMIT ${limit}
      )
      RETURNING ${dataTransfers.id}
    `);
    return rows.length;
  }

  // ── 建立者 ──

  /** 工作以建立者的身分執行（§12 D20）：讀出帳號狀態，與存取 token 的驗證同樣的條件。 */
  async findOwner(userId: string): Promise<TransferOwner | undefined> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        locale: users.locale,
        timezone: users.timezone,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }
}
