import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * 通訊軟體驗證碼的帳號綁定（docs/architecture/backend/21-mfa.md §9.5）：設定時產生一次性的綁定碼，使用者在 Telegram／LINE
 * 傳給我們的 Bot；Bot 的 webhook（平台層，不知道是哪個租戶）以綁定碼的雜湊找到這一列，記下收件對象。
 * 設定確認之後收件對象搬進因子（`secret_encrypted`），這一列由 `mfa.channelLinkCleanup` 在過期後刪除。
 *
 * 放平台 DB：webhook 只有一個網址、收到時不知道是哪個租戶。租戶的使用者以 `tenant_id` ＋ `account_id` 對應。
 */
export const mfaChannelLinks = pgTable(
  'mfa_channel_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 方式 id（`telegram`、`line`）。 */
    channel: text('channel').notNull(),
    /** 綁定碼的 HMAC（`MFA_SECRET_KEY` 的子金鑰）；不存明文。 */
    codeHash: text('code_hash').notNull().unique(),
    realm: text('realm').$type<'tenant' | 'platform'>().notNull(),
    /** 租戶的使用者才有；平台管理者是 null。不設外鍵：租戶刪除後由過期清理。 */
    tenantId: uuid('tenant_id'),
    accountId: uuid('account_id').notNull(),
    /** 收件對象（Telegram chat id、LINE user id），`MFA_SECRET_KEY` 加密；綁定之前是 null。 */
    recipientEncrypted: text('recipient_encrypted'),
    /** 對方在通訊軟體上的顯示名稱（列表的提示，例：`@alice`）。 */
    recipientName: text('recipient_name'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('mfa_channel_links_realm_check', sql`${t.realm} IN ('tenant', 'platform')`),
    index('mfa_channel_links_expires_at_idx').on(t.expiresAt),
  ],
);

export type MfaChannelLinkRow = typeof mfaChannelLinks.$inferSelect;
