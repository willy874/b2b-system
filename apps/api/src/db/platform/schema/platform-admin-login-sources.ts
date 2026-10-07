import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformAdmins } from './platform-admins';

/** 平台管理者登入成功過的來源（同租戶的 `user_login_sources`，docs/architecture/backend/04-auth.md §3.4）。 */
export const platformAdminLoginSources = pgTable(
  'platform_admin_login_sources',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    ipPrefix: text('ip_prefix').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.adminId, t.ipPrefix] }),
    index('platform_admin_login_sources_last_success_idx').on(t.lastSuccessAt),
  ],
);
