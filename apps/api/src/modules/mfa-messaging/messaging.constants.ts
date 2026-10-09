import { defineJob } from '@/core/jobs';

/** 驗證碼的有效時間與重送冷卻；綁定碼的有效時間（含綁定之後到確認設定）。 */
export const MESSAGING_CODE_TTL_SECONDS = 10 * 60;
export const MESSAGING_CODE_RESEND_SECONDS = 60;
export const MESSAGING_LINK_TTL_SECONDS = 30 * 60;

export interface MessagingCodeJobData {
  accountId: string;
  challengeId: string;
}

const MESSAGING_CODE_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelaySeconds: 10,
  retryDelayMaxSeconds: 60,
  expireInSeconds: 60,
  ignoreTenantConcurrency: true,
} as const;

/** 每種通訊軟體 × 每個身分範圍一種工作（平台的工作不能在租戶的交易裡入列）。 */
export function messagingCodeJobs(channel: 'telegram' | 'line') {
  const name = channel === 'telegram' ? 'Telegram' : 'Line';
  return {
    tenant: defineJob<MessagingCodeJobData>(`mfa.${channel}Code`, MESSAGING_CODE_JOB_OPTIONS),
    platform: defineJob<MessagingCodeJobData>(`mfa.platform${name}Code`, {
      ...MESSAGING_CODE_JOB_OPTIONS,
      scope: 'platform',
    }),
  };
}

/** 過期的綁定（`mfa_channel_links`）每天清除。 */
export const MFA_CHANNEL_LINK_CLEANUP_JOB = defineJob<Record<string, never>>(
  'mfa.channelLinkCleanup',
  { exclusive: true, retryLimit: 2, retryDelaySeconds: 300, scope: 'platform' },
);
