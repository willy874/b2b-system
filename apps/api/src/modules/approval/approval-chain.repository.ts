import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type {
  ApprovalDecisionRow,
  ApprovalFlowInsert,
  ApprovalFlowRow,
  ApprovalRequestRow,
  ApprovalStepInsert,
  ApprovalStepRow,
} from '@/db/schema';
import {
  approvalDecisions,
  approvalFlows,
  approvalRequests,
  approvalStepAssignees,
  approvalSteps,
  groups,
  notDeleted,
  roles,
  users,
} from '@/db/schema';

/** 列表一列的目前關卡摘要。 */
export interface CurrentStepSummary {
  ordinal: number;
  name: string;
  approvals: number;
  required: number;
  shortage: 'noCandidate' | 'insufficient' | null;
  /** 這一關開始的時間（列表顯示「已等多久」）。 */
  activatedAt: string | null;
  /** 還沒在這一關做決定的候選人，依名稱排序的前幾位（列表顯示「等待 王小明 等 3 人」）。 */
  pendingReviewers: string[];
  /** 還沒做決定的候選人數。 */
  pendingCount: number;
}

/** 列表上列出的未決定候選人數；其餘以人數表示。 */
const PENDING_REVIEWER_PREVIEW = 3;

/**
 * 多階段審批的資料存取（docs/architecture/backend/20-approval.md §9.3）：流程、關卡、候選人、決定。
 * 「可不可以」的判斷都在 `ApprovalChainService`。
 */
@Injectable()
export class ApprovalChainRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 流程 ─────────────────────────────────────────────

  async listFlows(): Promise<ApprovalFlowRow[]> {
    return this.db.select().from(approvalFlows).orderBy(asc(approvalFlows.type));
  }

  async findFlow(type: string, tx?: DbOrTx): Promise<ApprovalFlowRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(approvalFlows)
      .where(eq(approvalFlows.type, type))
      .limit(1);
    return row;
  }

  /** 照這個流程送出、還在審的請求數（儲存修改前的提醒）。 */
  async countInFlight(flowId: string): Promise<number> {
    return this.db.$count(
      approvalRequests,
      and(eq(approvalRequests.flowId, flowId), eq(approvalRequests.status, 'pending')),
    );
  }

  /**
   * 一種類型的實際運作（docs/architecture/backend/20-approval.md §9.16）：`since` 之後送出的請求依狀態計數、定案的平均時間；
   * 目前所有進行中的請求停在哪一關。走 `(status, created_at)` 的索引；量大時再改快照（§12 D9）。
   */
  async flowStats(
    type: string,
    since: Date,
  ): Promise<{
    byStatus: Map<string, number>;
    averageHours: number | null;
    pending: number;
    currentSteps: Array<{ name: string; pending: number; shortage: number }>;
  }> {
    const [statusRows, averageRows, pending, stepRows] = await Promise.all([
      this.db
        .select({ status: approvalRequests.status, count: sql<number>`count(*)::int` })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.type, type), gte(approvalRequests.createdAt, since)))
        .groupBy(approvalRequests.status),
      this.db
        .select({
          hours: sql<
            number | null
          >`avg(extract(epoch from (${approvalRequests.reviewedAt} - ${approvalRequests.createdAt})) / 3600)::float8`,
        })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.type, type),
            gte(approvalRequests.createdAt, since),
            inArray(approvalRequests.status, ['approved', 'rejected']),
          ),
        ),
      this.db.$count(
        approvalRequests,
        and(eq(approvalRequests.type, type), eq(approvalRequests.status, 'pending')),
      ),
      this.db
        .select({
          name: approvalSteps.name,
          pending: sql<number>`count(*)::int`,
          shortage: sql<number>`count(${approvalSteps.shortage})::int`,
        })
        .from(approvalSteps)
        .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
        .where(
          and(
            eq(approvalRequests.type, type),
            eq(approvalRequests.status, 'pending'),
            eq(approvalSteps.status, 'active'),
          ),
        )
        .groupBy(approvalSteps.name)
        .orderBy(sql`count(*) desc`, asc(approvalSteps.name)),
    ]);
    return {
      byStatus: new Map(statusRows.map((row) => [row.status, row.count])),
      averageHours: averageRows[0]?.hours ?? null,
      pending,
      currentSteps: stepRows,
    };
  }

  async lockFlow(type: string, tx: DbOrTx): Promise<ApprovalFlowRow | undefined> {
    const [row] = await tx
      .select()
      .from(approvalFlows)
      .where(eq(approvalFlows.type, type))
      .for('update');
    return row;
  }

  async insertFlow(values: ApprovalFlowInsert, tx: DbOrTx): Promise<ApprovalFlowRow> {
    const [row] = await tx.insert(approvalFlows).values(values).returning();
    if (!row) throw new Error('建立審批流程失敗');
    return row;
  }

  /** 條件式更新（樂觀鎖）：版本不符回 undefined。 */
  async updateFlow(
    type: string,
    values: Pick<ApprovalFlowInsert, 'enabled' | 'allowRepeatApprover' | 'steps' | 'updatedBy'>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<ApprovalFlowRow | undefined> {
    const [row] = await tx
      .update(approvalFlows)
      .set({ ...values, version: sql`${approvalFlows.version} + 1`, updatedAt: new Date() })
      .where(and(eq(approvalFlows.type, type), eq(approvalFlows.version, expectedVersion)))
      .returning();
    return row;
  }

  /**
   * 重設：刪掉這個類型的流程（docs/architecture/backend/20-approval.md §9.3、§12 D10）。已送出的請求帶著關卡的快照，
   * `approval_requests.flow_id` 沒有外鍵，照舊走完。
   */
  async deleteFlow(type: string, tx: DbOrTx): Promise<void> {
    await tx.delete(approvalFlows).where(eq(approvalFlows.type, type));
  }

  // ── 關卡 ─────────────────────────────────────────────

  async insertSteps(values: ApprovalStepInsert[], tx: DbOrTx): Promise<ApprovalStepRow[]> {
    if (!values.length) return [];
    return tx.insert(approvalSteps).values(values).returning();
  }

  async stepsOf(requestId: string, tx?: DbOrTx): Promise<ApprovalStepRow[]> {
    return (tx ?? this.db)
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, requestId))
      .orderBy(asc(approvalSteps.ordinal));
  }

  async updateStep(
    id: string,
    values: Partial<
      Pick<
        ApprovalStepInsert,
        'status' | 'shortage' | 'closeReason' | 'activatedAt' | 'closedAt' | 'requiredApprovals'
      >
    >,
    tx: DbOrTx,
  ): Promise<void> {
    await tx.update(approvalSteps).set(values).where(eq(approvalSteps.id, id));
  }

  /** 還沒結束（`waiting`／`active`）的關卡一律 `cancelled`。 */
  async cancelOpenSteps(
    requestId: string,
    reason: NonNullable<ApprovalStepRow['closeReason']>,
    tx: DbOrTx,
  ): Promise<void> {
    await tx
      .update(approvalSteps)
      .set({ status: 'cancelled', closeReason: reason, closedAt: new Date() })
      .where(
        and(
          eq(approvalSteps.requestId, requestId),
          inArray(approvalSteps.status, ['waiting', 'active']),
        ),
      );
  }

  /** 在交易內以 `FOR UPDATE` 鎖住請求列：同一筆請求的決定排隊（D16）。 */
  async lockRequest(id: string, tx: DbOrTx): Promise<ApprovalRequestRow | undefined> {
    const [row] = await tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .for('update');
    return row;
  }

  async setCurrentStep(requestId: string, ordinal: number | null, tx: DbOrTx): Promise<void> {
    await tx
      .update(approvalRequests)
      .set({ currentStep: ordinal, updatedAt: new Date() })
      .where(eq(approvalRequests.id, requestId));
  }

  // ── 候選人 ───────────────────────────────────────────

  /** 加入候選人；已在名單上的略過。回傳新加入的人。 */
  async addAssignees(
    stepId: string,
    requestId: string,
    userIds: readonly string[],
    addedBy: 'activation' | 'refresh',
    tx: DbOrTx,
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await tx
      .insert(approvalStepAssignees)
      .values(userIds.map((userId) => ({ stepId, requestId, userId, addedBy })))
      .onConflictDoNothing()
      .returning({ userId: approvalStepAssignees.userId });
    return rows.map((row) => row.userId);
  }

  async assigneeIdsOf(stepId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ userId: approvalStepAssignees.userId })
      .from(approvalStepAssignees)
      .where(eq(approvalStepAssignees.stepId, stepId));
    return rows.map((row) => row.userId);
  }

  /** 這些關卡的候選人（含名稱），依關卡分組。 */
  async assigneesOf(
    stepIds: readonly string[],
  ): Promise<Map<string, Array<{ userId: string; name: string }>>> {
    const result = new Map<string, Array<{ userId: string; name: string }>>();
    if (!stepIds.length) return result;
    const rows = await this.db
      .select({
        stepId: approvalStepAssignees.stepId,
        userId: approvalStepAssignees.userId,
        name: users.displayName,
      })
      .from(approvalStepAssignees)
      .innerJoin(users, eq(users.id, approvalStepAssignees.userId))
      .where(inArray(approvalStepAssignees.stepId, [...stepIds]))
      .orderBy(asc(users.displayName));
    for (const row of rows) {
      const list = result.get(row.stepId) ?? [];
      list.push({ userId: row.userId, name: row.name });
      result.set(row.stepId, list);
    }
    return result;
  }

  /** 這個人是不是這筆請求任一關的候選人（可見性，§9.10）。 */
  async isCandidateOfRequest(requestId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: approvalStepAssignees.userId })
      .from(approvalStepAssignees)
      .where(
        and(
          eq(approvalStepAssignees.requestId, requestId),
          eq(approvalStepAssignees.userId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** 這些人之中曾是這筆請求任一關候選人的（批次版的 `isCandidateOfRequest`）。 */
  async candidatesAmong(requestId: string, userIds: readonly string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await this.db
      .selectDistinct({ userId: approvalStepAssignees.userId })
      .from(approvalStepAssignees)
      .where(
        and(
          eq(approvalStepAssignees.requestId, requestId),
          inArray(approvalStepAssignees.userId, [...userIds]),
        ),
      );
    return rows.map((row) => row.userId);
  }

  // ── 決定 ─────────────────────────────────────────────

  async insertDecision(
    values: Pick<
      ApprovalDecisionRow,
      'requestId' | 'stepId' | 'reviewerId' | 'reviewerName' | 'decision' | 'via' | 'comment'
    >,
    tx: DbOrTx,
  ): Promise<void> {
    await tx.insert(approvalDecisions).values(values);
  }

  async decisionsOf(requestId: string): Promise<ApprovalDecisionRow[]> {
    return this.db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.requestId, requestId))
      .orderBy(asc(approvalDecisions.decidedAt), asc(approvalDecisions.id));
  }

  async approvalsOf(stepId: string, tx: DbOrTx): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.stepId, stepId), eq(approvalDecisions.decision, 'approve')))
      .limit(1);
    return row?.count ?? 0;
  }

  /** 這個人在這一關有沒有做過決定。 */
  async hasDecided(stepId: string, userId: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: approvalDecisions.id })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.stepId, stepId), eq(approvalDecisions.reviewerId, userId)))
      .limit(1);
    return Boolean(row);
  }

  /** 這筆請求前面的關卡做過決定的人（D6）。 */
  async deciderIdsOf(requestId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .selectDistinct({ reviewerId: approvalDecisions.reviewerId })
      .from(approvalDecisions)
      .where(
        and(eq(approvalDecisions.requestId, requestId), isNotNull(approvalDecisions.reviewerId)),
      );
    return rows.flatMap((row) => (row.reviewerId ? [row.reviewerId] : []));
  }

  // ── 使用者 ───────────────────────────────────────────

  /** 可以審核的人：未刪除、`active`、人類帳號（服務帳號不能登入，審不了）。 */
  async filterReviewableUsers(ids: readonly string[], tx?: DbOrTx): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await (tx ?? this.db)
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [...ids]),
          notDeleted(users),
          eq(users.status, 'active'),
          eq(users.kind, 'human'),
        ),
      );
    return rows.map((row) => row.id);
  }

  async userNames(
    ids: readonly string[],
  ): Promise<Map<string, { name: string; deleted: boolean }>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, name: users.displayName, deletedAt: users.deletedAt })
      .from(users)
      .where(inArray(users.id, [...ids]));
    return new Map(
      rows.map((row) => [row.id, { name: row.name, deleted: row.deletedAt !== null }]),
    );
  }

  /** 群組、角色的名稱（含已刪除的）：審核者規則的顯示名稱。 */
  async groupName(id: string): Promise<{ name: string; deleted: boolean } | undefined> {
    const [row] = await this.db
      .select({ name: groups.name, deletedAt: groups.deletedAt })
      .from(groups)
      .where(eq(groups.id, id))
      .limit(1);
    return row && { name: row.name, deleted: row.deletedAt !== null };
  }

  async roleName(id: string): Promise<{ name: string; deleted: boolean } | undefined> {
    const [row] = await this.db
      .select({ name: roles.name, deletedAt: roles.deletedAt })
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    return row && { name: row.name, deleted: row.deletedAt !== null };
  }

  // ── 列表 ─────────────────────────────────────────────

  /** 這些請求目前的關卡摘要與關卡總數（列表用，一次查齊）。 */
  async summariesOf(requestIds: readonly string[]): Promise<{
    current: Map<string, CurrentStepSummary>;
    counts: Map<string, number>;
  }> {
    const current = new Map<string, CurrentStepSummary>();
    const counts = new Map<string, number>();
    if (!requestIds.length) return { current, counts };
    const [active, totals] = await Promise.all([
      this.db
        .select({
          id: approvalSteps.id,
          requestId: approvalSteps.requestId,
          ordinal: approvalSteps.ordinal,
          name: approvalSteps.name,
          required: approvalSteps.requiredApprovals,
          shortage: approvalSteps.shortage,
          activatedAt: approvalSteps.activatedAt,
          // 單表 select 時 Drizzle 會把 ${approvalSteps.id} 輸出成不帶表名的 "id"，在子查詢裡會被當成 d.id：明確寫出表名
          approvals: sql<number>`(SELECT count(*)::int FROM ${approvalDecisions} d
            WHERE d.step_id = ${approvalSteps}.${sql.identifier(approvalSteps.id.name)}
              AND d.decision = 'approve')`,
        })
        .from(approvalSteps)
        .where(
          and(
            inArray(approvalSteps.requestId, [...requestIds]),
            eq(approvalSteps.status, 'active'),
          ),
        ),
      this.db
        .select({ requestId: approvalSteps.requestId, count: sql<number>`count(*)::int` })
        .from(approvalSteps)
        .where(inArray(approvalSteps.requestId, [...requestIds]))
        .groupBy(approvalSteps.requestId),
    ]);
    const pending = await this.undecidedOf(active.map((step) => step.id));
    for (const row of active) {
      const names = pending.get(row.id) ?? [];
      current.set(row.requestId, {
        ordinal: row.ordinal,
        name: row.name,
        approvals: row.approvals,
        required: row.required ?? 0,
        shortage: row.shortage ?? null,
        activatedAt: row.activatedAt?.toISOString() ?? null,
        pendingReviewers: names.slice(0, PENDING_REVIEWER_PREVIEW),
        pendingCount: names.length,
      });
    }
    for (const row of totals) counts.set(row.requestId, row.count);
    return { current, counts };
  }

  /** 每一關還沒做決定的候選人名稱（依名稱排序）。一頁最多幾十個進行中的關卡，名單不大，取回後在程式裡截斷。 */
  private async undecidedOf(stepIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!stepIds.length) return result;
    const rows = await this.db
      .select({ stepId: approvalStepAssignees.stepId, name: users.displayName })
      .from(approvalStepAssignees)
      .innerJoin(users, eq(users.id, approvalStepAssignees.userId))
      .leftJoin(
        approvalDecisions,
        and(
          eq(approvalDecisions.stepId, approvalStepAssignees.stepId),
          eq(approvalDecisions.reviewerId, approvalStepAssignees.userId),
        ),
      )
      .where(and(inArray(approvalStepAssignees.stepId, [...stepIds]), isNull(approvalDecisions.id)))
      .orderBy(asc(users.displayName));
    for (const row of rows) {
      const list = result.get(row.stepId) ?? [];
      list.push(row.name);
      result.set(row.stepId, list);
    }
    return result;
  }

  // ── 平台關閉前的影響（§9.11） ─────────────────────────

  async countImpact(): Promise<{ flows: number; inChain: number; usingOrg: number }> {
    const [row] = await this.db.execute<{ flows: number; in_chain: number; using_org: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${approvalFlows} f WHERE f.enabled) AS flows,
        (SELECT count(*)::int FROM ${approvalRequests} r
          WHERE r.status = 'pending' AND r.current_step IS NOT NULL) AS in_chain,
        (SELECT count(*)::int FROM ${approvalFlows} f WHERE f.enabled AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(f.steps) s
          WHERE s->'assignee'->>'kind' IN ('manager', 'orgUnit'))) AS using_org`);
    return { flows: row?.flows ?? 0, inChain: row?.in_chain ?? 0, usingOrg: row?.using_org ?? 0 };
  }
}
