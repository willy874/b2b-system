import { relations } from 'drizzle-orm';

import { approvalRequests } from './schema/approval-requests';
import { auditLogs } from './schema/audit-logs';
import { authTokens } from './schema/auth-tokens';
import { permissions } from './schema/permissions';
import { refreshTokens } from './schema/refresh-tokens';
import { rolePermissions } from './schema/role-permissions';
import { roles } from './schema/roles';
import { userRoles } from './schema/user-roles';
import { users } from './schema/users';
import { workspaceMemberRoles, workspaceMembers, workspaces } from './schema/workspaces';

export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
  workspaceMembers: many(workspaceMembers),
  refreshTokens: many(refreshTokens),
  authTokens: many(authTokens),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id] }),
}));

// audit_logs 刻意沒有外鍵關聯：使用者被硬刪除時稽核紀錄必須留著。
export const auditLogsRelations = relations(auditLogs, () => ({}));

// 申請人、審核者的名稱已快照在列上；關聯只供需要時 join。
export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  requester: one(users, { fields: [approvalRequests.requesterId], references: [users.id] }),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
  roles: many(workspaceMemberRoles),
}));

export const workspaceMemberRolesRelations = relations(workspaceMemberRoles, ({ one }) => ({
  member: one(workspaceMembers, {
    fields: [workspaceMemberRoles.workspaceId, workspaceMemberRoles.userId],
    references: [workspaceMembers.workspaceId, workspaceMembers.userId],
  }),
  role: one(roles, { fields: [workspaceMemberRoles.roleId], references: [roles.id] }),
}));
