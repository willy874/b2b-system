import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { RefreshTokenRow, RevokedReason } from '@/db/schema';
import { refreshTokens } from '@/db/schema';

import type { NextRefreshToken, RefreshTokenRecord, RefreshTokenStore } from './refresh-rotation';
import { sha256 } from './token-hash';

export interface IssueRefreshTokenInput {
  userId: string;
  /** 輪替時沿用家族的 id 與建立時間；沒給就是一次新的登入（新家族）。 */
  familyId?: string;
  familyCreatedAt?: Date;
  /** 經 SSO 發出時：哪個產品、哪個 IdP session（docs/architecture/04-sso.md §12.2 D4）。輪替時沿用。 */
  clientId?: string | null;
  idpSessionUid?: string | null;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** 寬限期內被取代的那張：不算「家族已撤銷」（refresh-rotation.ts 的 `supersede`）。 */
const SUPERSEDED: RevokedReason = 'superseded';

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return { ...row, subjectId: row.userId };
}

@Injectable()
export class RefreshTokenRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 給 `rotateRefreshToken` 的介面（目前租戶的 `refresh_tokens`）。 */
  readonly store: RefreshTokenStore = {
    findByHash: async (hash) => {
      const row = await this.findByHash(hash);
      return row && toRecord(row);
    },
    isFamilyRevoked: (familyId) => this.isFamilyRevoked(familyId),
    revokeFamily: (familyId, reason) => this.revokeFamily(familyId, reason),
    rotate: (row, next) =>
      withTransaction(this.db, async (tx) => {
        if (!(await this.markUsed(row.id, tx))) return undefined;
        return (await this.issueNext(row, next, tx)).raw;
      }),
    supersede: (row, next) =>
      withTransaction(this.db, async (tx) => {
        // 鎖住重送的那張：同一張的並行重送依序執行，每一個都看得到前一個發的新 token
        await tx
          .select({ id: refreshTokens.id })
          .from(refreshTokens)
          .where(eq(refreshTokens.id, row.id))
          .for('update');
        const [lastUsed] = await tx
          .select({ id: refreshTokens.id })
          .from(refreshTokens)
          .where(and(eq(refreshTokens.familyId, row.familyId), isNotNull(refreshTokens.usedAt)))
          .orderBy(desc(refreshTokens.usedAt))
          .limit(1);
        // 家族在它之後又續期過：它不是「上一張」，這是重用
        if (lastUsed?.id !== row.id) return undefined;
        const superseded = await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokedReason: SUPERSEDED })
          .where(
            and(
              eq(refreshTokens.familyId, row.familyId),
              isNull(refreshTokens.usedAt),
              isNull(refreshTokens.revokedAt),
            ),
          )
          .returning({ id: refreshTokens.id });
        if (!superseded.length) return undefined;
        return (await this.issueNext(row, next, tx)).raw;
      }),
  };

  /** 輪替：同一個家族、沿用產品與 IdP session。 */
  private issueNext(
    row: RefreshTokenRecord,
    next: NextRefreshToken,
    tx: DbOrTx,
  ): Promise<{ raw: string; row: RefreshTokenRow }> {
    return this.issue(
      {
        userId: row.subjectId,
        familyId: row.familyId,
        familyCreatedAt: row.familyCreatedAt,
        clientId: row.clientId,
        idpSessionUid: row.idpSessionUid,
        ...next,
      },
      tx,
    );
  }

  async findByHash(hash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    return row;
  }

  async issue(
    input: IssueRefreshTokenInput,
    tx?: DbOrTx,
  ): Promise<{ raw: string; row: RefreshTokenRow }> {
    const db = tx ?? this.db;
    const raw = randomBytes(32).toString('base64url');
    const [row] = await db
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        familyId: input.familyId ?? randomUUID(),
        ...(input.familyCreatedAt && { familyCreatedAt: input.familyCreatedAt }),
        tokenHash: sha256(raw),
        expiresAt: input.expiresAt,
        clientId: input.clientId ?? null,
        idpSessionUid: input.idpSessionUid ?? null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      })
      .returning();
    if (!row) throw new Error('建立 refresh token 失敗');
    return { raw, row };
  }

  /**
   * 只在尚未使用、尚未撤銷時標記為已使用。回傳是否標記成功：
   * `false` 代表併發的另一個請求搶先用掉或撤銷了它（條件式 UPDATE 由列鎖序列化）。
   */
  async markUsed(id: string, tx?: DbOrTx): Promise<boolean> {
    const db = tx ?? this.db;
    const rows = await db
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.id, id),
          isNull(refreshTokens.usedAt),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length > 0;
  }

  /** 家族裡是否有任何一張已被撤銷（撤銷一律以家族或使用者為單位；寬限期內被取代的不算）。 */
  async isFamilyRevoked(familyId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNotNull(refreshTokens.revokedAt),
          or(isNull(refreshTokens.revokedReason), ne(refreshTokens.revokedReason, SUPERSEDED)),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * 清理排程的一批（docs/architecture/backend/04-auth.md §8）：刪除過期超過 `retentionDays` 天的列，最多 `batchSize` 筆。
   * 只看 `expires_at`：還沒過期的列（包括已使用、已撤銷的）要留著做重用偵測與家族撤銷的判斷。
   */
  async deleteExpiredBatch(retentionDays: number, batchSize: number): Promise<number> {
    const expired = this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(lt(refreshTokens.expiresAt, sql`now() - make_interval(days => ${retentionDays}::int)`))
      .limit(batchSize);
    const rows = await this.db
      .delete(refreshTokens)
      .where(inArray(refreshTokens.id, expired))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async revokeFamily(familyId: string, reason: RevokedReason, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** 撤銷目前租戶的所有 session（租戶停用，docs/architecture/05-tenancy.md §10.2 D13）。 */
  async revokeAll(reason: RevokedReason): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(isNull(refreshTokens.revokedAt));
  }

  async revokeAllForUser(userId: string, reason: RevokedReason, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /** 單一登出：撤銷同一個 IdP session 底下所有產品的家族。回傳受影響的使用者。 */
  async revokeByIdpSession(
    idpSessionUid: string,
    reason: RevokedReason,
    tx?: DbOrTx,
  ): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.idpSessionUid, idpSessionUid), isNull(refreshTokens.revokedAt)))
      .returning({ userId: refreshTokens.userId });
    return [...new Set(rows.map((row) => row.userId))];
  }
}
