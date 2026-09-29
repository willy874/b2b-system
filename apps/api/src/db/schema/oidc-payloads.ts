import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `oidc-provider` 的通用儲存（docs/adr/0019-sso-identity-platform.md）：Session、Interaction、Grant、
 * AuthorizationCode… 都存成「模型名稱 ＋ id ＋ payload」。欄位對應它的 Adapter 介面：
 * `grant_id` 供 `revokeByGrantId`、`uid` 供 `findByUid`（Session）、`user_code` 供 `findByUserCode`（裝置流程，未啟用）。
 */
export const oidcPayloads = pgTable(
  'oidc_payloads',
  {
    /** 模型名稱：`Session`、`Interaction`、`Grant`、`AuthorizationCode`… */
    type: text('type').notNull(),
    id: text('id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    grantId: text('grant_id'),
    uid: text('uid'),
    userCode: text('user_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.type, t.id] }),
    index('oidc_payloads_grant_idx').on(t.grantId),
    index('oidc_payloads_uid_idx').on(t.type, t.uid),
    index('oidc_payloads_expires_idx').on(t.expiresAt), // 清理排程用
  ],
);

export type OidcPayloadRow = typeof oidcPayloads.$inferSelect;
