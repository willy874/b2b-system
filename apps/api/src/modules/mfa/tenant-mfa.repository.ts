import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import type { MfaChallenge, MfaFactor } from '@/core/mfa';
import { mfaChallenges, mfaFactors, mfaRecoveryCodes, notDeleted, users } from '@/db/schema';

import type { MfaRepository, NewMfaChallenge, NewMfaFactor } from './mfa.repository';

type FactorRow = typeof mfaFactors.$inferSelect;
type ChallengeRow = typeof mfaChallenges.$inferSelect;

function toFactor(row: FactorRow): MfaFactor {
  return {
    id: row.id,
    accountId: row.userId,
    method: row.method,
    label: row.label,
    status: row.status,
    secretEncrypted: row.secretEncrypted,
    config: row.config,
    lastUsedCounter: row.lastUsedCounter,
    lastUsedAt: row.lastUsedAt,
    interactionUid: row.interactionUid,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

function toChallenge(row: ChallengeRow): MfaChallenge {
  return {
    id: row.id,
    factorId: row.factorId,
    purpose: row.purpose,
    state: row.state,
    attempts: row.attempts,
    expiresAt: row.expiresAt,
    resendAfter: row.resendAfter,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

/**
 * 租戶 DB 的 `mfa_factors`、`mfa_challenges`、`mfa_recovery_codes`（docs/architecture/backend/21-mfa.md §3）。
 * 平台管理者的同一份查詢在 `platform-mfa.repository.ts`（兩邊的欄位相同，帳號欄是 `user_id`／`admin_id`）。
 * `users.mfa_enabled` 是這些表的衍生欄位，也在這裡維護。
 */
@Injectable()
export class TenantMfaRepository implements MfaRepository<DbOrTx> {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 因子 ───────────────────────────────────────────────

  async listFactors(accountId: string, tx: DbOrTx = this.db): Promise<MfaFactor[]> {
    const rows = await tx
      .select()
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, accountId))
      .orderBy(mfaFactors.createdAt);
    return rows.map(toFactor);
  }

  async findFactor(
    accountId: string,
    factorId: string,
    tx: DbOrTx = this.db,
  ): Promise<MfaFactor | undefined> {
    const [row] = await tx
      .select()
      .from(mfaFactors)
      .where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, accountId)))
      .limit(1);
    return row && toFactor(row);
  }

  async insertFactor(values: NewMfaFactor, tx: DbOrTx = this.db): Promise<MfaFactor> {
    const [row] = await tx
      .insert(mfaFactors)
      .values({
        userId: values.accountId,
        method: values.method,
        label: values.label,
        status: 'pending',
        secretEncrypted: values.secretEncrypted,
        config: values.config,
        interactionUid: values.interactionUid,
      })
      .returning();
    if (!row) throw new Error('建立 MFA 因子失敗');
    return toFactor(row);
  }

  async activateFactor(
    factorId: string,
    values: {
      label: string | null;
      lastUsedCounter: number | null;
      /** 驗證時方式給的更新（WebAuthn 的公鑰、通訊軟體的收件對象）：整份 `config`、新的密文。 */
      config?: Record<string, unknown>;
      secretEncrypted?: string;
    },
    tx: DbOrTx = this.db,
  ): Promise<boolean> {
    const now = new Date();
    const rows = await tx
      .update(mfaFactors)
      .set({
        status: 'active',
        label: values.label,
        lastUsedCounter: values.lastUsedCounter,
        lastUsedAt: values.lastUsedCounter === null ? null : now,
        ...(values.config !== undefined && { config: values.config }),
        ...(values.secretEncrypted !== undefined && { secretEncrypted: values.secretEncrypted }),
        interactionUid: null,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.status, 'pending')))
      .returning({ id: mfaFactors.id });
    return rows.length > 0;
  }

  async recordFactorUse(factorId: string, counter: number | null): Promise<boolean> {
    const now = new Date();
    // 防重放（§4.2）：計數必須比上一次接受的大，條件式更新讓併發的同一個碼只有一個成功
    const replayGuard =
      counter === null
        ? undefined
        : or(isNull(mfaFactors.lastUsedCounter), lt(mfaFactors.lastUsedCounter, counter));
    const rows = await this.db
      .update(mfaFactors)
      .set({
        lastUsedAt: now,
        updatedAt: now,
        ...(counter !== null && { lastUsedCounter: counter }),
      })
      .where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.status, 'active'), replayGuard))
      .returning({ id: mfaFactors.id });
    return rows.length > 0;
  }

  async deleteFactor(accountId: string, factorId: string, tx: DbOrTx = this.db): Promise<boolean> {
    const rows = await tx
      .delete(mfaFactors)
      .where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, accountId)))
      .returning({ id: mfaFactors.id });
    return rows.length > 0;
  }

  async deleteFactors(accountId: string, tx: DbOrTx = this.db): Promise<number> {
    const rows = await tx
      .delete(mfaFactors)
      .where(eq(mfaFactors.userId, accountId))
      .returning({ id: mfaFactors.id });
    return rows.length;
  }

  async deletePendingFactors(accountId: string, tx: DbOrTx = this.db): Promise<void> {
    await tx
      .delete(mfaFactors)
      .where(and(eq(mfaFactors.userId, accountId), eq(mfaFactors.status, 'pending')));
  }

  async syncMfaEnabled(accountId: string, tx: DbOrTx = this.db): Promise<boolean> {
    const active = sql<boolean>`EXISTS (SELECT 1 FROM ${mfaFactors} WHERE ${mfaFactors.userId} = ${users.id} AND ${mfaFactors.status} = 'active')`;
    const [row] = await tx
      .update(users)
      .set({ mfaEnabled: active })
      .where(eq(users.id, accountId))
      .returning({ mfaEnabled: users.mfaEnabled });
    return row?.mfaEnabled ?? false;
  }

  async countActiveFactorsByMethod(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ method: mfaFactors.method, value: count() })
      .from(mfaFactors)
      .where(eq(mfaFactors.status, 'active'))
      .groupBy(mfaFactors.method);
    return new Map(rows.map((row) => [row.method, row.value]));
  }

  /**
   * 關掉方式之後會被擋在門外的人數（§5、§6、D8）：可以登入、有 active 的因子，但每一個都不在 `allowedMethods`，也沒有未用的備用碼。
   */
  async countStranded(allowedMethods: readonly string[]): Promise<number> {
    const allowed = sql`ARRAY[${sql.join(
      allowedMethods.length ? allowedMethods.map((id) => sql`${id}`) : [sql`NULL`],
      sql`, `,
    )}]::text[]`;
    const [row] = await this.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM (
        SELECT f.user_id FROM ${mfaFactors} f
        JOIN ${users} u ON u.id = f.user_id AND u.deleted_at IS NULL /* notDeleted */ AND u.status = 'active'
        WHERE f.status = 'active'
        GROUP BY f.user_id
        HAVING bool_and(NOT (f.method = ANY(${allowed})))
          AND NOT EXISTS (
            SELECT 1 FROM ${mfaRecoveryCodes} r WHERE r.user_id = f.user_id AND r.used_at IS NULL
          )
      ) stranded`);
    return row?.count ?? 0;
  }

  /** 可以登入、還沒有任何 active 因子的人（「不符合政策的人數」的候選）。 */
  async listActiveUserIdsWithoutMfa(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.mfaEnabled, false),
          eq(users.status, 'active'),
          notDeleted(users),
          eq(users.kind, 'human'),
        ),
      );
    return rows.map((row) => row.id);
  }

  // ── challenge ─────────────────────────────────────────

  async insertChallenge(values: NewMfaChallenge, tx: DbOrTx = this.db): Promise<MfaChallenge> {
    const [row] = await tx
      .insert(mfaChallenges)
      .values({
        id: values.id,
        userId: values.accountId,
        factorId: values.factorId,
        purpose: values.purpose,
        interactionUid: values.interactionUid,
        state: values.state,
        expiresAt: values.expiresAt,
        resendAfter: values.resendAfter,
      })
      .returning();
    if (!row) throw new Error('建立 MFA challenge 失敗');
    return toChallenge(row);
  }

  async findChallenge(accountId: string, challengeId: string): Promise<MfaChallenge | undefined> {
    const [row] = await this.db
      .select()
      .from(mfaChallenges)
      .where(and(eq(mfaChallenges.id, challengeId), eq(mfaChallenges.userId, accountId)))
      .limit(1);
    return row && toChallenge(row);
  }

  async latestChallenge(factorId: string): Promise<MfaChallenge | undefined> {
    const [row] = await this.db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.factorId, factorId))
      .orderBy(desc(mfaChallenges.createdAt))
      .limit(1);
    return row && toChallenge(row);
  }

  async updateChallengeState(
    challengeId: string,
    state: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await this.db
      .update(mfaChallenges)
      .set({ state })
      .where(and(eq(mfaChallenges.id, challengeId), isNull(mfaChallenges.consumedAt)))
      .returning({ id: mfaChallenges.id });
    return rows.length > 0;
  }

  async incrementChallengeAttempts(challengeId: string): Promise<number> {
    const [row] = await this.db
      .update(mfaChallenges)
      .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
      .where(eq(mfaChallenges.id, challengeId))
      .returning({ attempts: mfaChallenges.attempts });
    return row?.attempts ?? Number.POSITIVE_INFINITY;
  }

  async consumeChallenge(challengeId: string): Promise<boolean> {
    const rows = await this.db
      .update(mfaChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaChallenges.id, challengeId), isNull(mfaChallenges.consumedAt)))
      .returning({ id: mfaChallenges.id });
    return rows.length > 0;
  }

  // ── 備用碼 ─────────────────────────────────────────────

  async replaceRecoveryCodes(
    accountId: string,
    hashes: readonly string[],
    tx: DbOrTx = this.db,
  ): Promise<void> {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, accountId));
    if (hashes.length === 0) return;
    await tx
      .insert(mfaRecoveryCodes)
      .values(hashes.map((codeHash) => ({ userId: accountId, codeHash })));
  }

  async consumeRecoveryCode(accountId: string, codeHash: string): Promise<boolean> {
    const rows = await this.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, accountId),
          eq(mfaRecoveryCodes.codeHash, codeHash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    return rows.length > 0;
  }

  async countRecoveryCodes(accountId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, accountId), isNull(mfaRecoveryCodes.usedAt)));
    return row?.value ?? 0;
  }

  // ── 清理 ───────────────────────────────────────────────

  async deleteStaleBatch(
    pendingBefore: Date,
    challengesBefore: Date,
    batchSize: number,
  ): Promise<number> {
    const staleFactors = this.db
      .select({ id: mfaFactors.id })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.status, 'pending'), lt(mfaFactors.createdAt, pendingBefore)))
      .limit(batchSize);
    const factors = await this.db
      .delete(mfaFactors)
      .where(inArray(mfaFactors.id, staleFactors))
      .returning({ id: mfaFactors.id });
    const staleChallenges = this.db
      .select({ id: mfaChallenges.id })
      .from(mfaChallenges)
      .where(lt(mfaChallenges.expiresAt, challengesBefore))
      .limit(batchSize);
    const challenges = await this.db
      .delete(mfaChallenges)
      .where(inArray(mfaChallenges.id, staleChallenges))
      .returning({ id: mfaChallenges.id });
    return factors.length + challenges.length;
  }
}
