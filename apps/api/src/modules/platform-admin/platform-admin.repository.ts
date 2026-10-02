import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { PlatformAdminRole, PlatformAdminRow } from '@/db/platform/schema';
import { notDeleted, platformAdmins, platformRefreshTokens } from '@/db/platform/schema';
import type { RevokedReason } from '@/db/schema';

export type PlatformAdminPatch = Partial<
  Pick<
    PlatformAdminRow,
    | 'failedLoginCount'
    | 'lockedUntil'
    | 'lastLoginAt'
    | 'status'
    | 'tokenVersion'
    | 'displayName'
    | 'role'
    | 'passwordHash'
  >
>;

/** 平台管理者（平台 DB，docs/architecture/05-tenancy.md §10.2 D5）。 */
@Injectable()
export class PlatformAdminRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async list(): Promise<PlatformAdminRow[]> {
    return this.db
      .select()
      .from(platformAdmins)
      .where(notDeleted(platformAdmins))
      .orderBy(asc(platformAdmins.createdAt), asc(platformAdmins.email));
  }

  async findByEmail(email: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.email, email), notDeleted(platformAdmins)))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.id, id), notDeleted(platformAdmins)))
      .limit(1);
    return row;
  }

  async create(input: {
    email: string;
    displayName: string;
    role: PlatformAdminRole;
  }): Promise<PlatformAdminRow> {
    const [row] = await this.db
      .insert(platformAdmins)
      .values({ ...input, status: 'pending' })
      .returning();
    if (!row) throw new Error('建立平台管理者失敗');
    return row;
  }

  /**
   * 登入失敗：原子遞增失敗次數，達到 `maxAttempts` 時鎖定（`status = locked`，平台管理介面以它顯示與解鎖）。
   * 上一次鎖定已過期時從 1 重新計算；鎖定中不更新（回傳 undefined）。規則與租戶的 `UserRepository.recordFailedLogin` 相同。
   */
  async recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<{ failedLoginCount: number; lockedUntil: Date | null } | undefined> {
    const lockExpired = sql`(${platformAdmins.lockedUntil} IS NOT NULL AND ${platformAdmins.lockedUntil} <= now())`;
    const nextCount = sql`(CASE WHEN ${lockExpired} THEN 1 ELSE ${platformAdmins.failedLoginCount} + 1 END)`;
    const reached = sql`${nextCount} >= ${maxAttempts}::int`;
    const [row] = await this.db
      .update(platformAdmins)
      .set({
        failedLoginCount: sql`${nextCount}`,
        lockedUntil: sql`CASE WHEN ${reached} THEN now() + make_interval(secs => ${lockoutSeconds}::int) ELSE NULL END`,
        status: sql`CASE WHEN ${reached} THEN 'locked'::platform_admin_status ELSE ${platformAdmins.status} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformAdmins.id, id),
          or(isNull(platformAdmins.lockedUntil), lte(platformAdmins.lockedUntil, sql`now()`)),
        ),
      )
      .returning({
        failedLoginCount: platformAdmins.failedLoginCount,
        lockedUntil: platformAdmins.lockedUntil,
      });
    return row;
  }

  async update(id: string, patch: PlatformAdminPatch, tx?: PlatformDbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(platformAdmins)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platformAdmins.id, id));
  }

  /**
   * 更新並結束這個人的所有 session（停用、重設密碼）：同一個交易裡改欄位、`token_version` + 1（既存的 access token 失效）、
   * 撤銷 refresh token。
   */
  async updateAndEndSessions(
    id: string,
    patch: PlatformAdminPatch,
    reason: RevokedReason,
  ): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await this.update(id, patch, tx);
      await this.incrementTokenVersion(id, tx);
      await this.revokeRefreshTokens(id, reason, tx);
    });
  }

  /** 讓這個人所有既存的 access token 失效。 */
  async incrementTokenVersion(id: string, tx?: PlatformDbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(platformAdmins)
      .set({ tokenVersion: sql`${platformAdmins.tokenVersion} + 1` })
      .where(eq(platformAdmins.id, id));
  }

  /** 撤銷這個人的所有 session（停用、重設密碼）。 */
  async revokeRefreshTokens(
    adminId: string,
    reason: RevokedReason,
    tx?: PlatformDbOrTx,
  ): Promise<void> {
    await (tx ?? this.db)
      .update(platformRefreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(eq(platformRefreshTokens.adminId, adminId), isNull(platformRefreshTokens.revokedAt)),
      );
  }

  /** `active` 的 super-admin 人數（`exceptId` 不算在內）。 */
  async countActiveSuperAdmins(exceptId?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(platformAdmins)
      .where(
        and(
          eq(platformAdmins.role, 'super-admin'),
          eq(platformAdmins.status, 'active'),
          notDeleted(platformAdmins),
          exceptId ? ne(platformAdmins.id, exceptId) : undefined,
        ),
      );
    return row?.total ?? 0;
  }
}
