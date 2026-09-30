import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, like } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern, prefixPattern } from '@/core/database';
import type { ApprovalRequestInsert, ApprovalRequestRow } from '@/db/schema';
import { approvalRequests, notDeleted, users } from '@/db/schema';

import type { ListApprovalDto } from './dto/approval.dto';

const SORT_COLUMNS = {
  createdAt: approvalRequests.createdAt,
  reviewedAt: approvalRequests.reviewedAt,
} as const;

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

  async list(query: ListApprovalDto): Promise<{ items: ApprovalRequestRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.keyword) {
      conditions.push(ilike(approvalRequests.requesterName, containsPattern(query.keyword)));
    }
    if (query.status?.length) conditions.push(inArray(approvalRequests.status, query.status));
    if (query.type?.length) conditions.push(inArray(approvalRequests.type, query.type));
    const where = conditions.length ? and(...conditions) : undefined;
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
