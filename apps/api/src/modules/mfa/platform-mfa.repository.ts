import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { MfaChallenge, MfaFactor } from '@/core/mfa';
import {
  platformAdminMfaChallenges,
  platformAdminMfaFactors,
  platformAdminMfaRecoveryCodes,
  platformAdmins,
} from '@/db/platform/schema';

import type { MfaRepository, NewMfaChallenge, NewMfaFactor } from './mfa.repository';

type FactorRow = typeof platformAdminMfaFactors.$inferSelect;
type ChallengeRow = typeof platformAdminMfaChallenges.$inferSelect;

function toFactor(row: FactorRow): MfaFactor {
  return {
    id: row.id,
    accountId: row.adminId,
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
 * 平台 DB 的 `platform_admin_mfa_*`（docs/architecture/backend/21-mfa.md §3）：與租戶的 `TenantMfaRepository` 同一份查詢，
 * 帳號欄是 `admin_id`。`platform_admins.mfa_enabled` 是這些表的衍生欄位，也在這裡維護。
 */
@Injectable()
export class PlatformMfaRepository implements MfaRepository<PlatformDbOrTx> {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  // ── 因子 ───────────────────────────────────────────────

  async listFactors(accountId: string, tx: PlatformDbOrTx = this.db): Promise<MfaFactor[]> {
    const rows = await tx
      .select()
      .from(platformAdminMfaFactors)
      .where(eq(platformAdminMfaFactors.adminId, accountId))
      .orderBy(platformAdminMfaFactors.createdAt);
    return rows.map(toFactor);
  }

  async findFactor(
    accountId: string,
    factorId: string,
    tx: PlatformDbOrTx = this.db,
  ): Promise<MfaFactor | undefined> {
    const [row] = await tx
      .select()
      .from(platformAdminMfaFactors)
      .where(
        and(
          eq(platformAdminMfaFactors.id, factorId),
          eq(platformAdminMfaFactors.adminId, accountId),
        ),
      )
      .limit(1);
    return row && toFactor(row);
  }

  async insertFactor(values: NewMfaFactor, tx: PlatformDbOrTx = this.db): Promise<MfaFactor> {
    const [row] = await tx
      .insert(platformAdminMfaFactors)
      .values({
        adminId: values.accountId,
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
    values: { label: string | null; lastUsedCounter: number | null },
    tx: PlatformDbOrTx = this.db,
  ): Promise<boolean> {
    const now = new Date();
    const rows = await tx
      .update(platformAdminMfaFactors)
      .set({
        status: 'active',
        label: values.label,
        lastUsedCounter: values.lastUsedCounter,
        lastUsedAt: values.lastUsedCounter === null ? null : now,
        interactionUid: null,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(platformAdminMfaFactors.id, factorId),
          eq(platformAdminMfaFactors.status, 'pending'),
        ),
      )
      .returning({ id: platformAdminMfaFactors.id });
    return rows.length > 0;
  }

  async recordFactorUse(factorId: string, counter: number | null): Promise<boolean> {
    const now = new Date();
    // 防重放（§4.2）：計數必須比上一次接受的大，條件式更新讓併發的同一個碼只有一個成功
    const replayGuard =
      counter === null
        ? undefined
        : or(
            isNull(platformAdminMfaFactors.lastUsedCounter),
            lt(platformAdminMfaFactors.lastUsedCounter, counter),
          );
    const rows = await this.db
      .update(platformAdminMfaFactors)
      .set({
        lastUsedAt: now,
        updatedAt: now,
        ...(counter !== null && { lastUsedCounter: counter }),
      })
      .where(
        and(
          eq(platformAdminMfaFactors.id, factorId),
          eq(platformAdminMfaFactors.status, 'active'),
          replayGuard,
        ),
      )
      .returning({ id: platformAdminMfaFactors.id });
    return rows.length > 0;
  }

  async deleteFactor(
    accountId: string,
    factorId: string,
    tx: PlatformDbOrTx = this.db,
  ): Promise<boolean> {
    const rows = await tx
      .delete(platformAdminMfaFactors)
      .where(
        and(
          eq(platformAdminMfaFactors.id, factorId),
          eq(platformAdminMfaFactors.adminId, accountId),
        ),
      )
      .returning({ id: platformAdminMfaFactors.id });
    return rows.length > 0;
  }

  async deleteFactors(accountId: string, tx: PlatformDbOrTx = this.db): Promise<number> {
    const rows = await tx
      .delete(platformAdminMfaFactors)
      .where(eq(platformAdminMfaFactors.adminId, accountId))
      .returning({ id: platformAdminMfaFactors.id });
    return rows.length;
  }

  async deletePendingFactors(accountId: string, tx: PlatformDbOrTx = this.db): Promise<void> {
    await tx
      .delete(platformAdminMfaFactors)
      .where(
        and(
          eq(platformAdminMfaFactors.adminId, accountId),
          eq(platformAdminMfaFactors.status, 'pending'),
        ),
      );
  }

  async syncMfaEnabled(accountId: string, tx: PlatformDbOrTx = this.db): Promise<boolean> {
    const active = sql<boolean>`EXISTS (SELECT 1 FROM ${platformAdminMfaFactors} WHERE ${platformAdminMfaFactors.adminId} = ${platformAdmins.id} AND ${platformAdminMfaFactors.status} = 'active')`;
    const [row] = await tx
      .update(platformAdmins)
      .set({ mfaEnabled: active })
      .where(eq(platformAdmins.id, accountId))
      .returning({ mfaEnabled: platformAdmins.mfaEnabled });
    return row?.mfaEnabled ?? false;
  }

  async countActiveFactorsByMethod(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ method: platformAdminMfaFactors.method, value: count() })
      .from(platformAdminMfaFactors)
      .where(eq(platformAdminMfaFactors.status, 'active'))
      .groupBy(platformAdminMfaFactors.method);
    return new Map(rows.map((row) => [row.method, row.value]));
  }

  // ── challenge ─────────────────────────────────────────

  async insertChallenge(
    values: NewMfaChallenge,
    tx: PlatformDbOrTx = this.db,
  ): Promise<MfaChallenge> {
    const [row] = await tx
      .insert(platformAdminMfaChallenges)
      .values({
        id: values.id,
        adminId: values.accountId,
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
      .from(platformAdminMfaChallenges)
      .where(
        and(
          eq(platformAdminMfaChallenges.id, challengeId),
          eq(platformAdminMfaChallenges.adminId, accountId),
        ),
      )
      .limit(1);
    return row && toChallenge(row);
  }

  async latestChallenge(factorId: string): Promise<MfaChallenge | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdminMfaChallenges)
      .where(eq(platformAdminMfaChallenges.factorId, factorId))
      .orderBy(desc(platformAdminMfaChallenges.createdAt))
      .limit(1);
    return row && toChallenge(row);
  }

  async updateChallengeState(
    challengeId: string,
    state: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await this.db
      .update(platformAdminMfaChallenges)
      .set({ state })
      .where(
        and(
          eq(platformAdminMfaChallenges.id, challengeId),
          isNull(platformAdminMfaChallenges.consumedAt),
        ),
      )
      .returning({ id: platformAdminMfaChallenges.id });
    return rows.length > 0;
  }

  async incrementChallengeAttempts(challengeId: string): Promise<number> {
    const [row] = await this.db
      .update(platformAdminMfaChallenges)
      .set({ attempts: sql`${platformAdminMfaChallenges.attempts} + 1` })
      .where(eq(platformAdminMfaChallenges.id, challengeId))
      .returning({ attempts: platformAdminMfaChallenges.attempts });
    return row?.attempts ?? Number.POSITIVE_INFINITY;
  }

  async consumeChallenge(challengeId: string): Promise<boolean> {
    const rows = await this.db
      .update(platformAdminMfaChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(platformAdminMfaChallenges.id, challengeId),
          isNull(platformAdminMfaChallenges.consumedAt),
        ),
      )
      .returning({ id: platformAdminMfaChallenges.id });
    return rows.length > 0;
  }

  // ── 備用碼 ─────────────────────────────────────────────

  async replaceRecoveryCodes(
    accountId: string,
    hashes: readonly string[],
    tx: PlatformDbOrTx = this.db,
  ): Promise<void> {
    await tx
      .delete(platformAdminMfaRecoveryCodes)
      .where(eq(platformAdminMfaRecoveryCodes.adminId, accountId));
    if (hashes.length === 0) return;
    await tx
      .insert(platformAdminMfaRecoveryCodes)
      .values(hashes.map((codeHash) => ({ adminId: accountId, codeHash })));
  }

  async consumeRecoveryCode(accountId: string, codeHash: string): Promise<boolean> {
    const rows = await this.db
      .update(platformAdminMfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(platformAdminMfaRecoveryCodes.adminId, accountId),
          eq(platformAdminMfaRecoveryCodes.codeHash, codeHash),
          isNull(platformAdminMfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: platformAdminMfaRecoveryCodes.id });
    return rows.length > 0;
  }

  async countRecoveryCodes(accountId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(platformAdminMfaRecoveryCodes)
      .where(
        and(
          eq(platformAdminMfaRecoveryCodes.adminId, accountId),
          isNull(platformAdminMfaRecoveryCodes.usedAt),
        ),
      );
    return row?.value ?? 0;
  }

  // ── 清理 ───────────────────────────────────────────────

  async deleteStaleBatch(
    pendingBefore: Date,
    challengesBefore: Date,
    batchSize: number,
  ): Promise<number> {
    const staleFactors = this.db
      .select({ id: platformAdminMfaFactors.id })
      .from(platformAdminMfaFactors)
      .where(
        and(
          eq(platformAdminMfaFactors.status, 'pending'),
          lt(platformAdminMfaFactors.createdAt, pendingBefore),
        ),
      )
      .limit(batchSize);
    const factors = await this.db
      .delete(platformAdminMfaFactors)
      .where(inArray(platformAdminMfaFactors.id, staleFactors))
      .returning({ id: platformAdminMfaFactors.id });
    const staleChallenges = this.db
      .select({ id: platformAdminMfaChallenges.id })
      .from(platformAdminMfaChallenges)
      .where(lt(platformAdminMfaChallenges.expiresAt, challengesBefore))
      .limit(batchSize);
    const challenges = await this.db
      .delete(platformAdminMfaChallenges)
      .where(inArray(platformAdminMfaChallenges.id, staleChallenges))
      .returning({ id: platformAdminMfaChallenges.id });
    return factors.length + challenges.length;
  }
}
