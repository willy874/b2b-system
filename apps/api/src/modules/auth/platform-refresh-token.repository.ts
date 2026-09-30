import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { PlatformRefreshTokenRow } from '@/db/platform/schema';
import { platformRefreshTokens } from '@/db/platform/schema';
import type { RevokedReason } from '@/db/schema';

import type { NextRefreshToken, RefreshTokenRecord, RefreshTokenStore } from './refresh-rotation';
import { sha256 } from './token-hash';

function toRecord(row: PlatformRefreshTokenRow): RefreshTokenRecord {
  return { ...row, subjectId: row.adminId };
}

/** 寬限期內被取代的那張：不算「家族已撤銷」（refresh-rotation.ts 的 `supersede`）。 */
const SUPERSEDED: RevokedReason = 'superseded';

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
            or(
              isNull(platformRefreshTokens.revokedReason),
              ne(platformRefreshTokens.revokedReason, SUPERSEDED),
            ),
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
        return (await this.issueNext(row, next, tx)).raw;
      }),
    // 規則與租戶的 RefreshTokenRepository.store.supersede 相同
    supersede: (row, next) =>
      withTransaction(this.db, async (tx) => {
        await tx
          .select({ id: platformRefreshTokens.id })
          .from(platformRefreshTokens)
          .where(eq(platformRefreshTokens.id, row.id))
          .for('update');
        const [lastUsed] = await tx
          .select({ id: platformRefreshTokens.id })
          .from(platformRefreshTokens)
          .where(
            and(
              eq(platformRefreshTokens.familyId, row.familyId),
              isNotNull(platformRefreshTokens.usedAt),
            ),
          )
          .orderBy(desc(platformRefreshTokens.usedAt))
          .limit(1);
        if (lastUsed?.id !== row.id) return undefined;
        const superseded = await tx
          .update(platformRefreshTokens)
          .set({ revokedAt: new Date(), revokedReason: SUPERSEDED })
          .where(
            and(
              eq(platformRefreshTokens.familyId, row.familyId),
              isNull(platformRefreshTokens.usedAt),
              isNull(platformRefreshTokens.revokedAt),
            ),
          )
          .returning({ id: platformRefreshTokens.id });
        if (!superseded.length) return undefined;
        return (await this.issueNext(row, next, tx)).raw;
      }),
  };

  private issueNext(
    row: RefreshTokenRecord,
    next: NextRefreshToken,
    tx: PlatformDbOrTx,
  ): Promise<{ raw: string }> {
    return this.issue(
      {
        adminId: row.subjectId,
        familyId: row.familyId,
        familyCreatedAt: row.familyCreatedAt,
        clientId: row.clientId,
        idpSessionUid: row.idpSessionUid,
        ...next,
      },
      tx,
    );
  }

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
      familyCreatedAt?: Date;
      clientId?: string | null;
      idpSessionUid?: string | null;
      expiresAt: Date;
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
      ...(input.familyCreatedAt && { familyCreatedAt: input.familyCreatedAt }),
      tokenHash: sha256(raw),
      expiresAt: input.expiresAt,
      clientId: input.clientId ?? null,
      idpSessionUid: input.idpSessionUid ?? null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    });
    return { raw };
  }

  /** 清理排程的一批：刪除過期超過 `retentionDays` 天的列（規則同租戶的 `RefreshTokenRepository.deleteExpiredBatch`）。 */
  async deleteExpiredBatch(retentionDays: number, batchSize: number): Promise<number> {
    const expired = this.db
      .select({ id: platformRefreshTokens.id })
      .from(platformRefreshTokens)
      .where(
        lt(
          platformRefreshTokens.expiresAt,
          sql`now() - make_interval(days => ${retentionDays}::int)`,
        ),
      )
      .limit(batchSize);
    const rows = await this.db
      .delete(platformRefreshTokens)
      .where(inArray(platformRefreshTokens.id, expired))
      .returning({ id: platformRefreshTokens.id });
    return rows.length;
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
