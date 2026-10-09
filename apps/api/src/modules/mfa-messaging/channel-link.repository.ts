import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import type { MfaRealm } from '@/core/mfa';
import { mfaChannelLinks } from '@/db/platform/schema';
import type { MfaChannelLinkRow } from '@/db/platform/schema';

/** 通訊軟體的帳號綁定（平台 DB；docs/architecture/backend/21-mfa.md §9.5）。 */
@Injectable()
export class ChannelLinkRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async insert(values: {
    channel: string;
    codeHash: string;
    realm: MfaRealm;
    tenantId: string | null;
    accountId: string;
    expiresAt: Date;
  }): Promise<MfaChannelLinkRow> {
    const [row] = await this.db.insert(mfaChannelLinks).values(values).returning();
    if (!row) throw new Error('寫入綁定失敗');
    return row;
  }

  /** 這個帳號的綁定（帳號與身分範圍都要對上：不能拿別人的綁定 id 來用）。 */
  async findOwned(
    id: string,
    owner: { realm: MfaRealm; tenantId: string | null; accountId: string },
  ): Promise<MfaChannelLinkRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mfaChannelLinks)
      .where(
        and(
          eq(mfaChannelLinks.id, id),
          eq(mfaChannelLinks.realm, owner.realm),
          owner.tenantId === null
            ? isNull(mfaChannelLinks.tenantId)
            : eq(mfaChannelLinks.tenantId, owner.tenantId),
          eq(mfaChannelLinks.accountId, owner.accountId),
        ),
      );
    return row;
  }

  /**
   * webhook 收到綁定碼：還沒綁定、沒過期的那一列記下收件對象。條件式更新：同一個碼只能綁一次。
   */
  async link(
    channel: string,
    codeHash: string,
    recipient: { encrypted: string; name: string | null },
  ): Promise<boolean> {
    const rows = await this.db
      .update(mfaChannelLinks)
      .set({
        recipientEncrypted: recipient.encrypted,
        recipientName: recipient.name,
        linkedAt: sql`now()`,
      })
      .where(
        and(
          eq(mfaChannelLinks.channel, channel),
          eq(mfaChannelLinks.codeHash, codeHash),
          isNull(mfaChannelLinks.linkedAt),
          gt(mfaChannelLinks.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: mfaChannelLinks.id });
    return rows.length > 0;
  }

  async deleteExpired(): Promise<number> {
    const rows = await this.db
      .delete(mfaChannelLinks)
      .where(lt(mfaChannelLinks.expiresAt, sql`now()`))
      .returning({ id: mfaChannelLinks.id });
    return rows.length;
  }
}
