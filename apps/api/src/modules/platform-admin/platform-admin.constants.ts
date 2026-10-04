import { defineJob } from '@/core/jobs';
import { MAIL_JOB_OPTIONS } from '@/core/mail';

export const PLATFORM_ACTIVATION_TTL_SECONDS = 24 * 60 * 60; // 24 小時
export const PLATFORM_PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 小時

/**
 * 平台管理者的啟用信與重設密碼信（同租戶的 `auth.activationMail`）。平台工作：沒有租戶脈絡，
 * 信中連結是 apps/platform 的 `/setup`、`/reset-password`，**不帶** `?tenant=`——頁面據此知道是平台管理者的帳號。
 * 工作資料只有 id：token 在寄出當下才簽發，原文不進工作資料（docs/architecture/backend/11-mail.md §4）。
 */
export const PLATFORM_ACCOUNT_MAIL_JOB = defineJob<{
  adminId: string;
  purpose: 'activation' | 'passwordReset';
}>('platformAdmin.accountMail', {
  ...MAIL_JOB_OPTIONS,
  scope: 'platform',
});
