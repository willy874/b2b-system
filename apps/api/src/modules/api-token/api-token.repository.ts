import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { apiTokens, notDeleted, users } from '@/db/schema';
import type { ApiTokenInsert, ApiTokenRow, UserKind, UserStatus } from '@/db/schema';

/** token 的擁有者：本人或服務帳號。 */
export interface TokenAccount {
  id: string;
  kind: UserKind;
  status: UserStatus;
  tokenVersion: number;
  email: string;
  displayName: string;
}

export interface ApiTokenWithCreator extends ApiTokenRow {
  creator: { id: string; displayName: string } | null;
}

const creator = alias(users, 'creator');

interface JoinedRow {
  token: ApiTokenRow;
  creatorId: string | null;
  creatorName: string | null;
}

/** 建立者已被硬刪除（回收桶清除）時沒有名字：顯示成 null。 */
function withCreator({ token, creatorId, creatorName }: JoinedRow): ApiTokenWithCreator {
  const result: ApiTokenWithCreator = Object.assign(token, { creator: null });
  if (creatorId && creatorName !== null)
    result.creator = { id: creatorId, displayName: creatorName };
  return result;
}

@Injectable()
export class ApiTokenRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 未刪除的帳號（人或服務帳號）。 */
  async findAccount(userId: string, tx?: DbOrTx): Promise<TokenAccount | undefined> {
    const [row] = await (tx ?? this.db)
      .select({
        id: users.id,
        kind: users.kind,
        status: users.status,
        tokenVersion: users.tokenVersion,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(and(eq(users.id, userId), notDeleted(users)))
      .limit(1);
    return row;
  }

  /** 一個帳號的所有 token（含已撤銷、已過期），新的在前。 */
  async list(userId: string): Promise<ApiTokenWithCreator[]> {
    const rows = await this.db
      .select({ token: apiTokens, creatorId: creator.id, creatorName: creator.displayName })
      .from(apiTokens)
      .leftJoin(creator, eq(creator.id, apiTokens.createdBy))
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
    return rows.map(withCreator);
  }

  async findOne(userId: string, tokenId: string): Promise<ApiTokenWithCreator | undefined> {
    const [row] = await this.db
      .select({ token: apiTokens, creatorId: creator.id, creatorName: creator.displayName })
      .from(apiTokens)
      .leftJoin(creator, eq(creator.id, apiTokens.createdBy))
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
      .limit(1);
    return row ? withCreator(row) : undefined;
  }

  /** 驗證用（對外 API）：以 id 找，不看擁有者。 */
  async findForVerification(tokenId: string): Promise<ApiTokenRow | undefined> {
    const [row] = await this.db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).limit(1);
    return row;
  }

  /** 批次更新最後使用時間（對外 API 每分鐘一次，D8）；只往後推。 */
  async touch(tokenIds: readonly string[], at: Date): Promise<void> {
    if (!tokenIds.length) return;
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: at })
      .where(
        and(
          inArray(apiTokens.id, [...tokenIds]),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, at)),
        ),
      );
  }

  /** 未撤銷、未過期的 token 數（上限的判斷用）。 */
  async countActive(userId: string, now: Date, tx?: DbOrTx): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({ total: count() })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.userId, userId),
          isNull(apiTokens.revokedAt),
          gt(apiTokens.expiresAt, now),
        ),
      );
    return row?.total ?? 0;
  }

  async insert(values: ApiTokenInsert, tx: DbOrTx): Promise<ApiTokenRow> {
    const [row] = await tx.insert(apiTokens).values(values).returning();
    if (!row) throw new Error('建立 API token 沒有回傳資料');
    return row;
  }

  /** 只撤銷還沒撤銷的；已撤銷（或不存在）回 undefined。 */
  async revoke(
    userId: string,
    tokenId: string,
    actorId: string,
    tx: DbOrTx,
  ): Promise<ApiTokenRow | undefined> {
    const [row] = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date(), revokedBy: actorId })
      .where(
        and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
      )
      .returning();
    return row;
  }

  /** 服務帳號被刪除時：它所有還沒撤銷的 token 標成撤銷（`token_version` 已讓它們失效，這裡讓列表顯示得清楚）。 */
  async revokeAll(userId: string, actorId: string, tx: DbOrTx): Promise<number> {
    const rows = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date(), revokedBy: actorId })
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    return rows.length;
  }
}
