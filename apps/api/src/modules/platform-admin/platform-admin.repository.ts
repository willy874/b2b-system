import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';

import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { PlatformAdminRole, PlatformAdminRow } from '@/db/platform/schema';
import { platformAdmins, platformRefreshTokens } from '@/db/platform/schema';
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

/** 平台管理者（平台 DB，docs/adr/0020-physical-tenant-isolation.md D5）。 */
@Injectable()
export class PlatformAdminRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async list(): Promise<PlatformAdminRow[]> {
    return this.db
      .select()
      .from(platformAdmins)
      .where(isNull(platformAdmins.deletedAt))
      .orderBy(asc(platformAdmins.createdAt), asc(platformAdmins.email));
  }

  async findByEmail(email: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.email, email), isNull(platformAdmins.deletedAt)))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformAdmins)
      .where(and(eq(platformAdmins.id, id), isNull(platformAdmins.deletedAt)))
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
          isNull(platformAdmins.deletedAt),
          exceptId ? ne(platformAdmins.id, exceptId) : undefined,
        ),
      );
    return row?.total ?? 0;
  }
}
