import { defineJob } from '@/core/jobs';
import { MAIL_JOB_OPTIONS } from '@/core/mail';

/** 驗證碼的有效時間與重寄冷卻（docs/architecture/backend/21-mfa.md §9.2）。 */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_CODE_RESEND_SECONDS = 60;
export const EMAIL_CODE_DIGITS = 6;

/** 工作資料只有帳號與 challenge：碼在 **寄出當下** 產生（docs/architecture/backend/11-mail.md §4）。 */
export interface EmailCodeJobData {
  accountId: string;
  challengeId: string;
}

/**
 * 驗證碼信不受租戶的同時執行上限限制：使用者正在登入頁等它，公告大量寄信時也不能被放回佇列（§9.2）。
 * 只重試幾次、間隔短：驗證碼 10 分鐘就過期，晚寄到也沒用。
 */
const EMAIL_CODE_JOB_OPTIONS = {
  ...MAIL_JOB_OPTIONS,
  retryLimit: 3,
  retryDelaySeconds: 10,
  retryDelayMaxSeconds: 60,
  expireInSeconds: 60,
  ignoreTenantConcurrency: true,
} as const;

export const MFA_EMAIL_CODE_JOB = defineJob<EmailCodeJobData>(
  'mfa.emailCodeMail',
  EMAIL_CODE_JOB_OPTIONS,
);
export const MFA_PLATFORM_EMAIL_CODE_JOB = defineJob<EmailCodeJobData>(
  'mfa.platformEmailCodeMail',
  { ...EMAIL_CODE_JOB_OPTIONS, scope: 'platform' },
);
