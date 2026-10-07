import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(), // 一次登入 = 一條輪替鏈
    /** 家族建立（登入）的時間，輪替時沿用：session 的絕對壽命由它起算（docs/architecture/backend/04-auth.md §2.6）。 */
    familyCreatedAt: timestamp('family_created_at', { withTimezone: true }).notNull().defaultNow(),
    tokenHash: text('token_hash').notNull(), // SHA-256(token)，不存明文

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }), // 已輪替
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'), // RevokedReason

    /**
     * 經 SSO 發出的 app session（docs/architecture/04-sso.md §12.2 D4）：哪個產品（OIDC client）、
     * 哪個 IdP session。單一登出以 `idp_session_uid` 找出同一個瀏覽器所有產品的家族。密碼直接登入時兩者皆為 null。
     */
    clientId: text('client_id'),
    idpSessionUid: text('idp_session_uid'),

    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    // 每次續期都要問「家族有沒有被撤銷」：只索引已撤銷的列，家族再長也是一次索引查找
    index('refresh_tokens_family_revoked_idx')
      .on(t.familyId)
      .where(sql`${t.revokedAt} IS NOT NULL`),
    index('refresh_tokens_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('refresh_tokens_expires_idx').on(t.expiresAt), // 清理排程用
    index('refresh_tokens_idp_session_idx')
      .on(t.idpSessionUid)
      .where(sql`${t.idpSessionUid} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type RevokedReason =
  | 'logout'
  | 'sso_logout'
  | 'reuse_detected'
  | 'user_disabled'
  | 'password_reset'
  /** 平台管理者停用或刪除了租戶（docs/architecture/05-tenancy.md §10.2 D13）。 */
  | 'tenant_disabled'
  /** 管理員重設了這個人的 MFA（docs/architecture/backend/21-mfa.md §8）。 */
  | 'mfa_reset'
  /** 寬限期內重送上一張，原本的最新一張被新發的取代；不代表家族被撤銷（04-auth.md §2.3）。 */
  | 'superseded';
