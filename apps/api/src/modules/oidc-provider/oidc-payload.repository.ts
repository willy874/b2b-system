import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { PlatformDatabase } from '@/core/database';
import { PLATFORM_DB } from '@/core/database';
import type { OidcPayloadRow } from '@/db/platform/schema';
import { oidcPayloads } from '@/db/platform/schema';

import { tenantAccountPrefix } from './oidc-account';

export interface UpsertOidcPayload {
  type: string;
  id: string;
  payload: Record<string, unknown>;
  grantId: string | null;
  uid: string | null;
  userCode: string | null;
  expiresAt: Date | null;
}

/** `oidc_payloads` 的查詢；判斷「是否過期、是否已用過」由 Adapter 決定。 */
@Injectable()
export class OidcPayloadRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async upsert(values: UpsertOidcPayload): Promise<void> {
    await this.db
      .insert(oidcPayloads)
      .values(values)
      .onConflictDoUpdate({
        target: [oidcPayloads.type, oidcPayloads.id],
        set: {
          payload: values.payload,
          grantId: values.grantId,
          uid: values.uid,
          userCode: values.userCode,
          expiresAt: values.expiresAt,
        },
      });
  }

  async find(type: string, id: string): Promise<OidcPayloadRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oidcPayloads)
      .where(and(eq(oidcPayloads.type, type), eq(oidcPayloads.id, id)))
      .limit(1);
    return row;
  }

  async findBy(
    type: string,
    column: 'uid' | 'userCode',
    value: string,
  ): Promise<OidcPayloadRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oidcPayloads)
      .where(and(eq(oidcPayloads.type, type), eq(oidcPayloads[column], value)))
      .limit(1);
    return row;
  }

  async consume(type: string, id: string): Promise<void> {
    await this.db
      .update(oidcPayloads)
      .set({ consumedAt: new Date() })
      .where(and(eq(oidcPayloads.type, type), eq(oidcPayloads.id, id)));
  }

  /**
   * 條件式消耗：只有尚未消耗時才成功，回傳是否搶到。一次性憑證（授權碼、外部登入的票）的「檢查 → 消耗」
   * 以它收尾，兩個併發的兌換只有一個成功。
   */
  async consumeOnce(type: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(oidcPayloads)
      .set({ consumedAt: new Date() })
      .where(
        and(eq(oidcPayloads.type, type), eq(oidcPayloads.id, id), isNull(oidcPayloads.consumedAt)),
      )
      .returning({ id: oidcPayloads.id });
    return rows.length > 0;
  }

  async destroy(type: string, id: string): Promise<void> {
    await this.db
      .delete(oidcPayloads)
      .where(and(eq(oidcPayloads.type, type), eq(oidcPayloads.id, id)));
  }

  /** 撤銷一個 grant 底下所有的 token（不分模型）。 */
  async destroyByGrantId(grantId: string): Promise<void> {
    await this.db.delete(oidcPayloads).where(eq(oidcPayloads.grantId, grantId));
  }

  /** 這些人的 IdP session（帳號停用、刪除、憑證失效時一併結束）。回傳刪除筆數。 */
  async destroySessionsOf(accountIds: readonly string[]): Promise<number> {
    if (accountIds.length === 0) return 0;
    const rows = await this.db
      .delete(oidcPayloads)
      .where(
        and(
          eq(oidcPayloads.type, 'Session'),
          inArray(sql<string>`${oidcPayloads.payload}->>'accountId'`, [...accountIds]),
        ),
      )
      .returning({ id: oidcPayloads.id });
    return rows.length;
  }

  /**
   * 某個租戶的所有帳號在 IdP 留下的東西：session、grant、授權碼、token（帳號 id 是 `t:{tenantId}:{userId}`）。
   * 停用、刪除租戶時用：重新啟用後不能靠舊的 IdP session 直接登回來。回傳刪除筆數。
   */
  async destroyAllOfTenant(tenantId: string): Promise<number> {
    const rows = await this.db
      .delete(oidcPayloads)
      .where(sql`${oidcPayloads.payload}->>'accountId' LIKE ${`${tenantAccountPrefix(tenantId)}%`}`)
      .returning({ id: oidcPayloads.id });
    return rows.length;
  }

  /** 清理排程：刪掉已過期的列。回傳刪除筆數。 */
  async deleteExpired(now = new Date()): Promise<number> {
    const rows = await this.db
      .delete(oidcPayloads)
      .where(lt(oidcPayloads.expiresAt, now))
      .returning({ id: oidcPayloads.id });
    return rows.length;
  }
}
