import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { RefreshTokenRow, RevokedReason } from '@/db/schema';
import { refreshTokens } from '@/db/schema';

import type { RefreshTokenRecord, RefreshTokenStore } from './refresh-rotation';
import { sha256 } from './token-hash';

export interface IssueRefreshTokenInput {
  userId: string;
  familyId?: string;
  /** 經 SSO 發出時：哪個產品、哪個 IdP session（docs/adr/0019-sso-identity-platform.md D4）。輪替時沿用。 */
  clientId?: string | null;
  idpSessionUid?: string | null;
  ttlSeconds: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}

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
        const issued = await this.issue(
          {
            userId: row.subjectId,
            familyId: row.familyId,
            clientId: row.clientId,
            idpSessionUid: row.idpSessionUid,
            ...next,
          },
          tx,
        );
        return issued.raw;
      }),
  };

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
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
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

  /** 家族裡是否有任何一張已被撤銷（撤銷一律以家族或使用者為單位）。 */
  async isFamilyRevoked(familyId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, familyId), isNotNull(refreshTokens.revokedAt)))
      .limit(1);
    return row !== undefined;
  }

  async revokeFamily(familyId: string, reason: RevokedReason, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
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
