import { Button, Link, Text } from '@react-email/components';

import { MAIL_FOOTER, MAIL_STYLES, MailLayout } from '@/core/mail';
import type { MailContent, MailLocale } from '@/core/mail';

/** 啟用信與重設密碼信：都是「點連結、設定密碼」，只有文案不同。 */
export type AccountLinkPurpose = 'activation' | 'passwordReset';

interface AccountLinkCopy {
  subject: string;
  preview: string;
  greeting: (name: string) => string;
  body: (hours: number) => string;
  action: string;
  fallback: string;
  ignore: string;
}

const COPY = {
  activation: {
    'zh-TW': {
      subject: '啟用你的 Game Editor 帳號',
      preview: '設定密碼後即可登入',
      greeting: (name) => `${name}，你好：`,
      body: (hours) =>
        `管理員為你建立了 Game Editor 帳號。請在 ${hours} 小時內點下方按鈕設定密碼並啟用帳號。`,
      action: '設定密碼',
      fallback: '按鈕無法使用時，請把這個網址貼到瀏覽器：',
      ignore: '如果你沒有預期收到這封信，可以直接忽略。',
    },
    'en-US': {
      subject: 'Activate your Game Editor account',
      preview: 'Set a password to sign in',
      greeting: (name) => `Hi ${name},`,
      body: (hours) =>
        `An administrator created a Game Editor account for you. Set your password within ${hours} hours to activate it.`,
      action: 'Set password',
      fallback: 'If the button does not work, paste this address into your browser:',
      ignore: 'If you were not expecting this email, you can ignore it.',
    },
  },
  passwordReset: {
    'zh-TW': {
      subject: '重設你的 Game Editor 密碼',
      preview: '點連結設定新密碼',
      greeting: (name) => `${name}，你好：`,
      body: (hours) =>
        `我們收到重設密碼的要求。請在 ${hours} 小時內點下方按鈕設定新密碼；設定後其他裝置會被登出。`,
      action: '重設密碼',
      fallback: '按鈕無法使用時，請把這個網址貼到瀏覽器：',
      ignore: '如果不是你提出的要求，可以忽略這封信，密碼不會改變。',
    },
    'en-US': {
      subject: 'Reset your Game Editor password',
      preview: 'Follow the link to choose a new password',
      greeting: (name) => `Hi ${name},`,
      body: (hours) =>
        `We received a request to reset your password. Choose a new one within ${hours} hours; other devices will be signed out.`,
      action: 'Reset password',
      fallback: 'If the button does not work, paste this address into your browser:',
      ignore:
        'If you did not request this, you can ignore this email and your password will not change.',
    },
  },
} as const satisfies Record<AccountLinkPurpose, Record<MailLocale, AccountLinkCopy>>;

export interface AccountLinkMailProps {
  purpose: AccountLinkPurpose;
  locale: MailLocale;
  displayName: string;
  link: string;
  /** 連結有效的小時數（與 token 的 TTL 一致） */
  validHours: number;
}

export function accountLinkMail({
  purpose,
  locale,
  displayName,
  link,
  validHours,
}: AccountLinkMailProps): MailContent {
  const copy: AccountLinkCopy = COPY[purpose][locale];
  return {
    subject: copy.subject,
    body: (
      <MailLayout locale={locale} preview={copy.preview} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.greeting(displayName)}</Text>
        <Text style={MAIL_STYLES.text}>{copy.body(validHours)}</Text>
        <Button href={link} style={MAIL_STYLES.button}>
          {copy.action}
        </Button>
        <Text style={MAIL_STYLES.muted}>
          {copy.fallback}
          <br />
          <Link href={link}>{link}</Link>
        </Text>
        <Text style={MAIL_STYLES.muted}>{copy.ignore}</Text>
      </MailLayout>
    ),
  };
}
