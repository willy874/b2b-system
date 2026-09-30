import { relations } from 'drizzle-orm';

import { approvalRequests } from './schema/approval-requests';
import { auditLogs } from './schema/audit-logs';
import { authTokens } from './schema/auth-tokens';
import { refreshTokens } from './schema/refresh-tokens';
import { users } from './schema/users';

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  authTokens: many(authTokens),
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
