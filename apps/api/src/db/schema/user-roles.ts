import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { roles } from './roles';
import { users } from './users';

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index('user_roles_role_idx').on(t.roleId), // 「誰持有這個角色」＋ 快取失效用
  ],
);

export type UserRoleRow = typeof userRoles.$inferSelect;
