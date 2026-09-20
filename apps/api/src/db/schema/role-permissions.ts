import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { permissions } from './permissions';
import { roles } from './roles';
import { users } from './users';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_idx').on(t.permissionId),
  ],
);

export type RolePermissionRow = typeof rolePermissions.$inferSelect;
