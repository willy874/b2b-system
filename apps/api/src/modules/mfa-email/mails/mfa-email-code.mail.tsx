import { Text } from '@b2b-system/mail-components';

import { MAIL_FOOTER, MAIL_STYLES, MailLayout } from '@/core/mail';
import type { MailContent, MailLocale } from '@/core/mail';

const COPY = {
  'zh-TW': {
    subject: (code: string) => `${code} 是你的驗證碼`,
    preview: '多重驗證的驗證碼',
    greeting: (name: string) => `${name}，你好：`,
    body: {
      login: '你正在登入，請輸入以下驗證碼完成多重驗證：',
      enroll: '你正在設定以 Email 接收驗證碼，請輸入以下驗證碼確認：',
    },
    expiry: (minutes: number) => `驗證碼 ${minutes} 分鐘內有效，只能使用一次。`,
    warning:
      '如果這不是你本人的操作，代表有人知道你的密碼：請立即變更密碼，並不要把驗證碼告訴任何人。',
  },
  'en-US': {
    subject: (code: string) => `${code} is your verification code`,
    preview: 'Your multi-factor authentication code',
    greeting: (name: string) => `Hi ${name},`,
    body: {
      login: 'You are signing in. Enter this code to complete multi-factor authentication:',
      enroll: 'You are setting up email verification codes. Enter this code to confirm:',
    },
    expiry: (minutes: number) => `The code is valid for ${minutes} minutes and can be used once.`,
    warning:
      'If this was not you, someone knows your password: change it right away and never share this code.',
  },
} as const;

export interface MfaEmailCodeMailProps {
  locale: MailLocale;
  displayName: string;
  code: string;
  purpose: 'login' | 'enroll';
  validMinutes: number;
}

/** Email 驗證碼（docs/architecture/backend/21-mfa.md §9.2）：碼在寄出當下產生，資料庫只存它的 HMAC。 */
export function mfaEmailCodeMail({
  locale,
  displayName,
  code,
  purpose,
  validMinutes,
}: MfaEmailCodeMailProps): MailContent {
  const copy = COPY[locale];
  return {
    subject: copy.subject(code),
    body: (
      <MailLayout locale={locale} preview={copy.preview} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.greeting(displayName)}</Text>
        <Text style={MAIL_STYLES.text}>{copy.body[purpose]}</Text>
        <Text
          style={{ ...MAIL_STYLES.text, fontSize: '28px', fontWeight: 700, letterSpacing: '6px' }}
        >
          {code}
        </Text>
        <Text style={MAIL_STYLES.muted}>{copy.expiry(validMinutes)}</Text>
        <Text style={MAIL_STYLES.muted}>{copy.warning}</Text>
      </MailLayout>
    ),
  };
}
