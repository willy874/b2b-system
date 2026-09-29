import { defineJob } from '@/core/jobs';

/**
 * 工作資料只有 `userId`：token 在 **寄出當下** 才簽發（docs/architecture/backend/11-mail.md §4）。
 * 資料庫只存 token 的雜湊，入列時若先簽發，就得把原文放進工作資料——而 `job:read` 看得到工作資料。
 */
export interface AccountMailJobData {
  userId: string;
}

// 寄信失敗多半是 SMTP 暫時不可用：多重試幾次、間隔拉長
const MAIL_RETRY = { retryLimit: 8, retryDelaySeconds: 60, retryDelayMaxSeconds: 60 * 60 };

/** 啟用信（管理員建立帳號後）。`UserService` 入列、`AuthMailJobs` 寄出。 */
export const ACTIVATION_MAIL_JOB = defineJob<AccountMailJobData>('auth.activationMail', MAIL_RETRY);

/** 重設密碼信（忘記密碼、管理員代為重設）。 */
export const PASSWORD_RESET_MAIL_JOB = defineJob<AccountMailJobData>(
  'auth.passwordResetMail',
  MAIL_RETRY,
);

/** 忘記密碼的節流：同一個帳號一分鐘內只寄一封，重複按不會洗信箱。 */
export const FORGOT_PASSWORD_THROTTLE_SECONDS = 60;
