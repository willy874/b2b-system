import { Text } from '@b2b-system/mail-components';

import { MAIL_FOOTER, MAIL_STYLES, MailLayout } from '@/core/mail';
import type { MailContent, MailLocale } from '@/core/mail';

import type { MfaSecurityEvent } from '../mfa-security-event';

const EVENT_COPY = {
  'zh-TW': {
    factorAdded: '你的帳號新增了一個兩步驟驗證方式。',
    factorRemoved: '你的帳號移除了一個兩步驟驗證方式。',
    recoveryCodesRegenerated: '你的帳號重新產生了備用碼，舊的備用碼已全部失效。',
    recoveryCodeUsed: '有人以備用碼登入了你的帳號。',
    reset: '管理員重設了你的兩步驟驗證：所有驗證方式與備用碼都已刪除，所有裝置都已登出。',
  },
  'en-US': {
    factorAdded: 'A two-step verification method was added to your account.',
    factorRemoved: 'A two-step verification method was removed from your account.',
    recoveryCodesRegenerated:
      'New recovery codes were generated for your account. The old codes no longer work.',
    recoveryCodeUsed: 'Someone signed in to your account with a recovery code.',
    reset:
      'An administrator reset your two-step verification: all methods and recovery codes were removed and you were signed out everywhere.',
  },
} as const satisfies Record<MailLocale, Record<MfaSecurityEvent, string>>;

const COPY = {
  'zh-TW': {
    subject: '你的帳號安全設定有變更',
    preview: '兩步驟驗證的設定有變更',
    greeting: (name: string) => `${name}，你好：`,
    warning: '如果這不是你本人的操作，請立即變更密碼並聯絡管理員。',
  },
  'en-US': {
    subject: 'Your account security settings changed',
    preview: 'Your two-step verification settings changed',
    greeting: (name: string) => `Hi ${name},`,
    warning: 'If this was not you, change your password right away and contact your administrator.',
  },
} as const;

export interface MfaSecurityNoticeMailProps {
  locale: MailLocale;
  displayName: string;
  event: MfaSecurityEvent;
}

/**
 * 安全通知信（docs/architecture/backend/21-mfa.md §7）：MFA 的設定有變更時寄給本人。只偷到密碼的人在「必須啟用卻還沒設定」的帳號
 * 綁上自己的裝置時，本人會收到這封信。
 */
export function mfaSecurityNoticeMail({
  locale,
  displayName,
  event,
}: MfaSecurityNoticeMailProps): MailContent {
  const copy = COPY[locale];
  return {
    subject: copy.subject,
    body: (
      <MailLayout locale={locale} preview={copy.preview} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.greeting(displayName)}</Text>
        <Text style={MAIL_STYLES.text}>{EVENT_COPY[locale][event]}</Text>
        <Text style={MAIL_STYLES.muted}>{copy.warning}</Text>
      </MailLayout>
    ),
  };
}
