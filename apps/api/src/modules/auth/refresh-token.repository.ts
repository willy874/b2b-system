import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { RefreshTokenRow, RevokedReason } from '@/db/schema';
import { refreshTokens } from '@/db/schema';

import { sha256 } from './auth-token.service';

export interface IssueRefreshTokenInput {
  userId: string;
  familyId?: string;
  ttlSeconds: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      })
      .returning();
    if (!row) throw new Error('建立 refresh token 失敗');
    return { raw, row };
  }

  async markUsed(id: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, id));
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
}
