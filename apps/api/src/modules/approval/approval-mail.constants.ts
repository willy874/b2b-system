import { defineJob } from '@/core/jobs';
import { MAIL_JOB_OPTIONS } from '@/core/mail';

export interface ApprovalResultMailJobData {
  approvalId: string;
}

/**
 * 審核結果通知申請人（docs/architecture/backend/20-approval.md §6）。核准／駁回的交易內入列；
 * 收件人與內容在寄出時才從請求讀取。
 */
export const APPROVAL_RESULT_MAIL_JOB = defineJob<ApprovalResultMailJobData>(
  'approval.resultMail',
  MAIL_JOB_OPTIONS,
);
