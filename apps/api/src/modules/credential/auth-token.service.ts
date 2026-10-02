import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { SettingService } from '@/core/settings';
import type { AuthTokenPurpose, AuthTokenRow } from '@/db/schema';
import { authTokens } from '@/db/schema';

import { ACTIVATION_TTL_HOURS_SETTING, PASSWORD_RESET_TTL_HOURS_SETTING } from './auth.settings';
import { sha256 } from './token-hash';

/** 啟用 / 密碼重設 token（`auth_tokens`）。 */
@Injectable()
export class AuthTokenService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly settings: SettingService,
  ) {}

  /**
   * 發新 token 前先作廢同使用者同用途的既有未使用 token。
   * 只由寄信的背景工作呼叫（`AuthMailJobs`）：寄出當下才簽發，原文不進工作資料。
   */
  async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    tx?: DbOrTx,
  ): Promise<{ raw: string; expiresAt: Date; validHours: number }> {
    const db = tx ?? this.db;
    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
        ),
      );

    const raw = randomBytes(32).toString('base64url');
    // 有效時數是租戶的設定；信裡寫的時數與實際到期時間出自同一個值
    const validHours = await this.settings.get(
      purpose === 'activation' ? ACTIVATION_TTL_HOURS_SETTING : PASSWORD_RESET_TTL_HOURS_SETTING,
    );
    const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000);

    await db.insert(authTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt });
    // 原文只回給寄信的工作放進連結，不寫日誌（docs/architecture/backend/11-mail.md §9.2 D7）
    return { raw, expiresAt, validHours };
  }

  async findUsable(raw: string, purpose: AuthTokenPurpose): Promise<AuthTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, sha256(raw)), eq(authTokens.purpose, purpose)))
      .limit(1);
    if (!row) return undefined;
    if (row.usedAt) return undefined;
    if (row.expiresAt.getTime() < Date.now()) return undefined;
    return row;
  }

  /**
   * 條件式地標記為已使用：只有尚未使用、尚未過期才成功。回傳是否搶到——`false` 代表同一個連結被併發的請求
   * （雙擊、兩個分頁）先用掉了，呼叫端要讓整個交易失敗。
   */
  async markUsed(id: string, tx?: DbOrTx): Promise<boolean> {
    const db = tx ?? this.db;
    const rows = await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(eq(authTokens.id, id), isNull(authTokens.usedAt), gt(authTokens.expiresAt, sql`now()`)),
      )
      .returning({ id: authTokens.id });
    return rows.length > 0;
  }

  /**
   * 作廢使用者所有未使用的啟用／重設 token（停用、刪除帳號時，在同一個交易內）：
   * 否則已寄出的連結在有效期內仍能把帳號改回 `active` 或設定密碼。
   */
  async revokeUnused(userId: string, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)));
  }

  /**
   * 清理排程的一批：刪除過期或用過超過 `retentionDays` 天的列，最多 `batchSize` 筆（docs/architecture/backend/04-auth.md §8）。
   * 保留一段時間是為了事後調查「這個連結什麼時候被用過」。回傳這一批刪除的筆數。
   */
  async deleteStaleBatch(retentionDays: number, batchSize: number): Promise<number> {
    const cutoff = sql`now() - make_interval(days => ${retentionDays}::int)`;
    const stale = this.db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(or(lt(authTokens.expiresAt, cutoff), lt(authTokens.usedAt, cutoff)))
      .limit(batchSize);
    const rows = await this.db
      .delete(authTokens)
      .where(inArray(authTokens.id, stale))
      .returning({ id: authTokens.id });
    return rows.length;
  }
}
