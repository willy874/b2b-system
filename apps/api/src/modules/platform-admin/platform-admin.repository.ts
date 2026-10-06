import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
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

  async create(
    input: { email: string; displayName: string; role: PlatformAdminRole },
    tx?: PlatformDbOrTx,
  ): Promise<PlatformAdminRow> {
    const [row] = await (tx ?? this.db)
      .insert(platformAdmins)
      .values({ ...input, status: 'pending' })
      .returning();
    if (!row) throw new Error('建立平台管理者失敗');
    return row;
  }

  /**
   * 登入失敗：原子遞增失敗次數，達到 `maxAttempts` 時鎖定。**只寫 `locked_until`、不改 `status`**：改了 status，
   * 任何知道 email 的人錯 N 次就能把線上的平台管理者踢下線（docs/architecture/backend/04-auth.md §3.3）；
   * 管理介面顯示的 `locked` 由 `locked_until` 推出。上一次鎖定已過期時從 1 重新計算；鎖定中不更新（回傳 undefined）。
   * 規則與租戶的 `UserRepository.recordFailedLogin` 相同。
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

  /**
   * 更新一位（未刪除的）平台管理者；`statusIn` 有值時只在目前的狀態是其中之一才更新（例：重設密碼不能把剛被停用的人改回 active）。
   * 回傳有沒有更新到。結束 session（停用、重設密碼）由 service 在同一個交易裡再呼叫 `incrementTokenVersion`、`revokeRefreshTokens`。
   */
  async update(
    id: string,
    patch: PlatformAdminPatch,
    tx?: PlatformDbOrTx,
    options: { statusIn?: readonly PlatformAdminRow['status'][] } = {},
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .update(platformAdmins)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(platformAdmins.id, id),
          notDeleted(platformAdmins),
          options.statusIn ? inArray(platformAdmins.status, [...options.statusIn]) : undefined,
        ),
      )
      .returning({ id: platformAdmins.id });
    return rows.length > 0;
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

  /**
   * 「最後一位 super-admin」檢查的鎖（交易層級的 advisory lock）：計數與寫入之間不能有別的交易插進來，
   * 否則兩位 super-admin 同時互相降級會都成功（docs/architecture/backend/05-rbac.md §8.2；租戶端的 `lockSuperAdminGuard`）。
   */
  async lockSuperAdminGuard(tx: PlatformDbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('platform_super_admin_guard'))`);
  }

  /** `active` 的 super-admin 人數（`exceptId` 不算在內）。在 `lockSuperAdminGuard` 之後、同一個交易內呼叫。 */
  async countActiveSuperAdmins(exceptId?: string, tx?: PlatformDbOrTx): Promise<number> {
    const [row] = await (tx ?? this.db)
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
