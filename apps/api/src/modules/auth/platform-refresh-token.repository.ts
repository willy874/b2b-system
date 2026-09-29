import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { PlatformRefreshTokenRow } from '@/db/platform/schema';
import { platformRefreshTokens } from '@/db/platform/schema';
import type { RevokedReason } from '@/db/schema';

import type { RefreshTokenRecord, RefreshTokenStore } from './refresh-rotation';
import { sha256 } from './token-hash';

function toRecord(row: PlatformRefreshTokenRow): RefreshTokenRecord {
  return { ...row, subjectId: row.adminId };
}

/** 平台管理者的 refresh token（平台 DB）；查詢形狀與租戶的 `RefreshTokenRepository` 相同。 */
@Injectable()
export class PlatformRefreshTokenRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  /** 給 `rotateRefreshToken` 的介面。 */
  readonly store: RefreshTokenStore = {
    findByHash: async (hash) => {
      const row = await this.findByHash(hash);
      return row && toRecord(row);
    },
    isFamilyRevoked: async (familyId) => {
      const [row] = await this.db
        .select({ id: platformRefreshTokens.id })
        .from(platformRefreshTokens)
        .where(
          and(
            eq(platformRefreshTokens.familyId, familyId),
            isNotNull(platformRefreshTokens.revokedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    revokeFamily: (familyId, reason) => this.revokeFamily(familyId, reason),
    rotate: (row, next) =>
      withTransaction(this.db, async (tx) => {
        const marked = await tx
          .update(platformRefreshTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(platformRefreshTokens.id, row.id),
              isNull(platformRefreshTokens.usedAt),
              isNull(platformRefreshTokens.revokedAt),
            ),
          )
          .returning({ id: platformRefreshTokens.id });
        if (!marked.length) return undefined;
        const issued = await this.issue(
          {
            adminId: row.subjectId,
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

  async findByHash(hash: string): Promise<PlatformRefreshTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformRefreshTokens)
      .where(eq(platformRefreshTokens.tokenHash, hash))
      .limit(1);
    return row;
  }

  async issue(
    input: {
      adminId: string;
      familyId?: string;
      clientId?: string | null;
      idpSessionUid?: string | null;
      ttlSeconds: number;
      userAgent?: string | null;
      ipAddress?: string | null;
    },
    tx?: PlatformDbOrTx,
  ): Promise<{ raw: string }> {
    const db = tx ?? this.db;
    const raw = randomBytes(32).toString('base64url');
    await db.insert(platformRefreshTokens).values({
      adminId: input.adminId,
      familyId: input.familyId ?? randomUUID(),
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      clientId: input.clientId ?? null,
      idpSessionUid: input.idpSessionUid ?? null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    });
    return { raw };
  }

  async revokeFamily(familyId: string, reason: RevokedReason): Promise<void> {
    await this.db
      .update(platformRefreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(eq(platformRefreshTokens.familyId, familyId), isNull(platformRefreshTokens.revokedAt)),
      );
  }

  /** 單一登出：撤銷同一個 IdP session 的家族。 */
  async revokeByIdpSession(idpSessionUid: string, reason: RevokedReason): Promise<void> {
    await this.db
      .update(platformRefreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(platformRefreshTokens.idpSessionUid, idpSessionUid),
          isNull(platformRefreshTokens.revokedAt),
        ),
      );
  }
}
