import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, like, notInArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern, prefixPattern } from '@/core/database';
import type { ApprovalRequestInsert, ApprovalRequestRow } from '@/db/schema';
import {
  approvalDecisions,
  approvalRequests,
  approvalStepAssignees,
  approvalSteps,
  notDeleted,
  users,
} from '@/db/schema';

import type { ListApprovalDto } from './dto/approval.dto';

const SORT_COLUMNS = {
  createdAt: approvalRequests.createdAt,
  reviewedAt: approvalRequests.reviewedAt,
} as const;

/** 匯出的範圍（docs/architecture/backend/22-data-transfer.md §12.5）：勾選的 id，或列表的篩選條件（不含 `scope`：匯出要 `approval:export`，看得到全部）。 */
/** 列表、待審數、匯出共用：排除的類型（所屬 feature 沒有開放，由 service 決定）。 */
interface ExcludedTypes {
  excludeTypes?: readonly string[];
}

export type ApprovalExportScope = (
  | { ids: readonly string[] }
  | { filter: Pick<ListApprovalDto, 'keyword' | 'status' | 'type'> }
) &
  ExcludedTypes;

export interface ApprovalExportCursor {
  createdAt: Date;
  id: string;
}

/** 匯出的一筆請求：加上目前關卡的名稱（多階段）。 */
export interface ApprovalExportRow extends ApprovalRequestRow {
  currentStepName: string | null;
  stepCount: number;
}

/** 匯出的一筆決定：多階段的每一關每一人；單關的請求以請求上的審核者表示（`stepOrdinal` 為 null）。 */
export interface ApprovalDecisionExportRow {
  id: string;
  requestId: string;
  type: string;
  requesterName: string;
  stepOrdinal: number | null;
  stepName: string | null;
  reviewerName: string;
  decision: 'approve' | 'reject';
  via: string;
  comment: string | null;
  decidedAt: Date;
}

export interface ApprovalDecisionCursor {
  decidedAt: Date;
  id: string;
}

/** 列表與待審數共用的條件。 */
export type ApprovalCountFilter = Pick<ListApprovalDto, 'scope' | 'keyword' | 'status' | 'type'> &
  ExcludedTypes;

/** 審核結果；只會套用在仍為 `pending` 的列上。 */
export type ApprovalReview = Pick<
  ApprovalRequestInsert,
  'status' | 'reviewerId' | 'reviewerName' | 'reviewComment' | 'reviewedAt'
>;

@Injectable()
export class ApprovalRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async create(values: ApprovalRequestInsert, tx?: DbOrTx): Promise<ApprovalRequestRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(approvalRequests).values(values).returning();
    if (!row) throw new Error('建立審批請求失敗');
    return row;
  }

  async findById(id: string): Promise<ApprovalRequestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    return row;
  }

  /** 通知信的收件人：未刪除的使用者。 */
  async findRecipient(userId: string): Promise<{ email: string; locale: string } | undefined> {
    const [row] = await this.db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(and(eq(users.id, userId), notDeleted(users)))
      .limit(1);
    return row;
  }

  async findPending(type: string, subjectKey: string): Promise<ApprovalRequestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.type, type),
          eq(approvalRequests.subjectKey, subjectKey),
          eq(approvalRequests.status, 'pending'),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * 某類型的待審請求，依 `subject_key` 前綴或申請人篩選（最早的在前）。
   * 給「只看得到自己負責的那部分」的審核入口（例：資料夾的管理者）用。
   */
  async findPendingBy(
    type: string,
    filter: { subjectKeyPrefix?: string; requesterId?: string },
  ): Promise<ApprovalRequestRow[]> {
    const conditions: SQL[] = [
      eq(approvalRequests.type, type),
      eq(approvalRequests.status, 'pending'),
    ];
    if (filter.subjectKeyPrefix !== undefined) {
      conditions.push(like(approvalRequests.subjectKey, prefixPattern(filter.subjectKeyPrefix)));
    }
    if (filter.requesterId !== undefined) {
      conditions.push(eq(approvalRequests.requesterId, filter.requesterId));
    }
    return this.db
      .select()
      .from(approvalRequests)
      .where(and(...conditions))
      .orderBy(asc(approvalRequests.createdAt), asc(approvalRequests.id));
  }

  /**
   * 列表。`scope`（docs/architecture/backend/20-approval.md §9.13）：`mine` 是 `actorId` 送出的；`assigned` 是 `actorId`
   * 為目前關卡的候選人、還沒在這一關做決定的待審請求。
   */
  async list(
    query: ListApprovalDto & ExcludedTypes,
    actorId: string,
  ): Promise<{ items: ApprovalRequestRow[]; total: number }> {
    const where = this.listWhere(query, actorId);
    // 最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    const [items, total] = await Promise.all([
      this.db
        .select()
        .from(approvalRequests)
        .where(where)
        .orderBy(...orderBy, desc(approvalRequests.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.$count(approvalRequests, where),
    ]);
    return { items, total };
  }

  /** 與列表同樣的條件只算筆數（待審數）。 */
  count(filter: ApprovalCountFilter, actorId: string): Promise<number> {
    return this.db.$count(approvalRequests, this.listWhere(filter, actorId));
  }

  /**
   * 以 `id` 為前一筆重新送出的最新一筆。重新送出的一定是同一個申請人（`ApprovalService.submit()` 驗證），
   * 以申請人限定範圍才用得到「我的申請」的索引（`resubmitted_from` 沒有索引）。
   */
  async findResubmission(id: string, requesterId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.requesterId, requesterId),
          eq(approvalRequests.resubmittedFrom, id),
        ),
      )
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  private listWhere(filter: ApprovalCountFilter, actorId: string): SQL | undefined {
    const conditions: SQL[] = [];
    if (filter.scope === 'mine') conditions.push(eq(approvalRequests.requesterId, actorId));
    if (filter.scope === 'assigned') {
      // 子查詢用別名手寫條件：計數的查詢是單表 select，Drizzle 會把 ${approvalRequests.id} 輸出成不帶表名的 "id"
      const outerId = sql`${approvalRequests}.${sql.identifier(approvalRequests.id.name)}`;
      conditions.push(
        eq(approvalRequests.status, 'pending'),
        sql`EXISTS (SELECT 1 FROM ${approvalSteps} s
          JOIN ${approvalStepAssignees} a ON a.step_id = s.id AND a.user_id = ${actorId}
          WHERE s.request_id = ${outerId} AND s.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM ${approvalDecisions} d
              WHERE d.step_id = s.id AND d.reviewer_id = ${actorId}))`,
      );
    }
    if (filter.keyword) {
      conditions.push(ilike(approvalRequests.requesterName, containsPattern(filter.keyword)));
    }
    if (filter.status?.length) conditions.push(inArray(approvalRequests.status, filter.status));
    if (filter.type?.length) conditions.push(inArray(approvalRequests.type, filter.type));
    if (filter.excludeTypes?.length) {
      conditions.push(notInArray(approvalRequests.type, [...filter.excludeTypes]));
    }
    return conditions.length ? and(...conditions) : undefined;
  }

  // ── 匯出（docs/architecture/backend/22-data-transfer.md §12.5）────────

  /** 依建立時間的 keyset 逐頁讀；目前關卡的名稱一頁一次查詢。 */
  async exportPage(
    scope: ApprovalExportScope,
    after: ApprovalExportCursor | null,
    limit: number,
  ): Promise<ApprovalExportRow[]> {
    const rows = await this.db
      .select({
        request: approvalRequests,
        currentStepName: sql<string | null>`(SELECT s.name FROM ${approvalSteps} s
          WHERE s.request_id = ${approvalRequests.id} AND s.ordinal = ${approvalRequests.currentStep})`,
        stepCount: sql<number>`(SELECT count(*)::int FROM ${approvalSteps} s
          WHERE s.request_id = ${approvalRequests.id})`,
      })
      .from(approvalRequests)
      .where(
        and(
          this.exportWhere(scope),
          after
            ? sql`(${approvalRequests.createdAt}, ${approvalRequests.id}) > (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(approvalRequests.createdAt), asc(approvalRequests.id))
      .limit(limit);
    return rows.map((row) => ({
      ...row.request,
      currentStepName: row.currentStepName,
      stepCount: row.stepCount,
    }));
  }

  exportCount(scope: ApprovalExportScope): Promise<number> {
    return this.db.$count(approvalRequests, this.exportWhere(scope));
  }

  /**
   * 決定：多階段的每一筆決定，加上沒有決定紀錄的單關請求（以請求上的審核者表示）。範圍是請求的範圍；
   * 依決定時間的 keyset 逐頁讀。
   */
  async exportDecisions(
    scope: ApprovalExportScope,
    after: ApprovalDecisionCursor | null,
    limit: number,
  ): Promise<ApprovalDecisionExportRow[]> {
    const rows = await this.db.execute<
      Omit<ApprovalDecisionExportRow, 'decidedAt'> & { decidedAt: string | Date } & Record<
          string,
          unknown
        >
    >(sql`
      SELECT * FROM (${this.decisionRows(scope)}) d
      ${
        after
          ? sql`WHERE (d."decidedAt", d.id) > (${after.decidedAt.toISOString()}::timestamptz, ${after.id})`
          : sql``
      }
      ORDER BY d."decidedAt", d.id
      LIMIT ${limit}`);
    return rows.map((row) => ({ ...row, decidedAt: new Date(row.decidedAt) }));
  }

  async exportDecisionCount(scope: ApprovalExportScope): Promise<number> {
    const [row] = await this.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM (${this.decisionRows(scope)}) d`,
    );
    return row?.total ?? 0;
  }

  private decisionRows(scope: ApprovalExportScope): SQL {
    // 範圍以子查詢表示：篩選條件是請求表的欄位（`exportWhere`），在單表的子查詢裡才不會跟決定表的欄位混淆
    const inScope = this.db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(this.exportWhere(scope));
    return sql`
      SELECT d.id::text AS id, r.id::text AS "requestId", r.type AS type, r.requester_name AS "requesterName",
        s.ordinal::int AS "stepOrdinal", s.name AS "stepName", d.reviewer_name AS "reviewerName",
        d.decision AS decision, d.via AS via, d.comment AS comment, d.decided_at AS "decidedAt"
      FROM ${approvalDecisions} d
      JOIN ${approvalSteps} s ON s.id = d.step_id
      JOIN ${approvalRequests} r ON r.id = d.request_id
      WHERE r.id IN (${inScope})
      UNION ALL
      SELECT r.id::text AS id, r.id::text AS "requestId", r.type AS type, r.requester_name AS "requesterName",
        NULL::int AS "stepOrdinal", NULL AS "stepName", r.reviewer_name AS "reviewerName",
        CASE r.status WHEN 'approved' THEN 'approve' ELSE 'reject' END AS decision, 'single' AS via,
        r.review_comment AS comment, r.reviewed_at AS "decidedAt"
      FROM ${approvalRequests} r
      WHERE r.id IN (${inScope}) AND r.status IN ('approved', 'rejected') AND r.reviewed_at IS NOT NULL
        AND r.reviewer_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${approvalDecisions} x WHERE x.request_id = r.id)`;
  }

  private exportWhere(scope: ApprovalExportScope): SQL | undefined {
    const conditions: SQL[] = [];
    if (scope.excludeTypes?.length) {
      conditions.push(notInArray(approvalRequests.type, [...scope.excludeTypes]));
    }
    if ('ids' in scope) return and(inArray(approvalRequests.id, [...scope.ids]), ...conditions);
    const { keyword, status, type } = scope.filter;
    if (keyword) conditions.push(ilike(approvalRequests.requesterName, containsPattern(keyword)));
    if (status?.length) conditions.push(inArray(approvalRequests.status, status));
    if (type?.length) conditions.push(inArray(approvalRequests.type, type));
    return conditions.length ? and(...conditions) : undefined;
  }

  /**
   * 條件式更新：只有仍為 `pending` 的列會被改。兩個審核者同時送出時只有一個拿得到列，
   * 另一個得到 `undefined`。同時清掉 `private_payload`——審核後不再需要，也不該留著。
   */
  async review(
    id: string,
    review: ApprovalReview,
    tx: DbOrTx,
  ): Promise<ApprovalRequestRow | undefined> {
    const [row] = await tx
      .update(approvalRequests)
      .set({ ...review, privatePayload: null })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')))
      .returning();
    return row;
  }

  async setResult(id: string, resultResourceId: string | null, tx: DbOrTx): Promise<void> {
    await tx.update(approvalRequests).set({ resultResourceId }).where(eq(approvalRequests.id, id));
  }
}
