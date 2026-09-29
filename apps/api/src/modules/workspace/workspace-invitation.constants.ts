import { defineJob } from '@/core/jobs';

/** 邀請的有效期限：每次寄出都從寄出當下重新起算（外包常常隔幾天才看信）。 */
export const WORKSPACE_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 信中連結的前端路徑（apps/auth 的接受邀請頁，以 `AUTH_APP_URL` 開頭）。 */
export const WORKSPACE_INVITATION_PATH = '/invitation';

/**
 * 工作資料只有 `invitationId`：token 在 **寄出當下** 才簽發（docs/architecture/backend/11-mail.md §4），
 * 原文不進工作資料——`job:read` 看得到工作資料。
 */
export interface WorkspaceInvitationMailJobData {
  invitationId: string;
}

/** 邀請信。`WorkspaceInvitationService` 入列、`WorkspaceInvitationJobs` 寄出。 */
export const WORKSPACE_INVITATION_MAIL_JOB = defineJob<WorkspaceInvitationMailJobData>(
  'workspace.invitationMail',
  // 與帳號信相同：寄信失敗多半是 SMTP 暫時不可用
  { retryLimit: 8, retryDelaySeconds: 60, retryDelayMaxSeconds: 60 * 60 },
);
