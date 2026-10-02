import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from './custom-types';
import { users } from './users';

/**
 * 外部 IdP 登入後找不到對應帳號時怎麼辦（docs/architecture/04-sso.md §12.2 D10）。
 * `approval`（走註冊審批）這一版不做：現有的註冊審批以密碼建立帳號，SSO 帳號沒有密碼。
 */
export const unmatchedAccountPolicy = pgEnum('unmatched_account_policy', ['reject', 'auto_create']);

/**
 * 外部 IdP 連線（OIDC，D8）。屬於平台、綁 email 網域（D9）。client secret 以 `IDP_SECRET_KEY` 加密（D11），
 * 讀取 API 不回傳。
 */
export const identityProviders = pgTable(
  'identity_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 登入頁上的顯示名稱（例：「Acme Azure AD」）。 */
    name: text('name').notNull(),
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    /** AES-256-GCM 密文（`iv.tag.ciphertext`，base64url）。 */
    clientSecretEncrypted: text('client_secret_encrypted').notNull(),
    scopes: text('scopes').notNull().default('openid email profile'),
    enabled: boolean('enabled').notNull().default(true),
    unmatchedPolicy: unmatchedAccountPolicy('unmatched_policy').notNull().default('reject'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('identity_providers_name_key')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/**
 * email 網域 → 連線（home realm discovery，D9）。一個網域只屬於一個連線；
 * `sso_only`：這個網域的帳號不能用密碼登入、不能申請重設密碼。
 */
export const identityProviderDomains = pgTable(
  'identity_provider_domains',
  {
    domain: citext('domain').primaryKey(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => identityProviders.id, { onDelete: 'cascade' }),
    ssoOnly: boolean('sso_only').notNull().default(false),
  },
  (t) => [index('identity_provider_domains_provider_idx').on(t.providerId)],
);

/**
 * 帳號 ↔ 外部身分（D8）。`subject` 是外部 IdP 的穩定識別碼（email 會變），所以以 `(provider_id, subject)` 唯一。
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => identityProviders.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    /** 連結當下外部 IdP 回報的 email（稽核與顯示用；對應只看 subject）。 */
    email: citext('email'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_identities_provider_subject_key').on(t.providerId, t.subject),
    index('user_identities_user_idx').on(t.userId),
  ],
);

export type IdentityProviderRow = typeof identityProviders.$inferSelect;
export type IdentityProviderInsert = typeof identityProviders.$inferInsert;
export type IdentityProviderDomainRow = typeof identityProviderDomains.$inferSelect;
export type UserIdentityRow = typeof userIdentities.$inferSelect;
export type UnmatchedAccountPolicy = (typeof unmatchedAccountPolicy.enumValues)[number];
