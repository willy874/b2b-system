import { defineJob } from '@/core/jobs';

export interface ApprovalResultMailJobData {
  approvalId: string;
}

/**
 * 審核結果通知申請人（docs/rbac/06-approval.md §6）。核准／駁回的交易內入列；
 * 收件人與內容在寄出時才從請求讀取。
 */
export const APPROVAL_RESULT_MAIL_JOB = defineJob<ApprovalResultMailJobData>(
  'approval.resultMail',
  { retryLimit: 8, retryDelaySeconds: 60, retryDelayMaxSeconds: 60 * 60 },
);
