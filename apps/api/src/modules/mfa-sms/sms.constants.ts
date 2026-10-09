import { defineJob } from '@/core/jobs';

/** 驗證碼的有效時間與重寄冷卻（docs/architecture/backend/21-mfa.md §9.4）：與 Email 相同。 */
export const SMS_CODE_TTL_SECONDS = 10 * 60;
export const SMS_CODE_RESEND_SECONDS = 60;

/** 供應商：Twilio，或自訂的 HTTP 閘道（平台自己的簡訊服務、其他供應商的轉接）。 */
export const SMS_PROVIDERS = ['twilio', 'webhook'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

/** 工作資料只有帳號與 challenge：碼在 **送出當下** 產生，不經過佇列（與 Email 相同，11-mail.md §4）。 */
export interface SmsCodeJobData {
  accountId: string;
  challengeId: string;
}

/**
 * 驗證碼簡訊不受租戶的同時執行上限限制（使用者正在登入頁等它）；只重試幾次、間隔短：碼 10 分鐘就過期。
 */
const SMS_CODE_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelaySeconds: 10,
  retryDelayMaxSeconds: 60,
  expireInSeconds: 60,
  ignoreTenantConcurrency: true,
} as const;

export const MFA_SMS_CODE_JOB = defineJob<SmsCodeJobData>('mfa.smsCode', SMS_CODE_JOB_OPTIONS);
export const MFA_PLATFORM_SMS_CODE_JOB = defineJob<SmsCodeJobData>('mfa.platformSmsCode', {
  ...SMS_CODE_JOB_OPTIONS,
  scope: 'platform',
});
