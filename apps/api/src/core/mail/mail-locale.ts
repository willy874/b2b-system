/** 信件支援的語系；與前端 `apps/backstage` 的語系一致。 */
export const MAIL_LOCALES = ['zh-TW', 'en-US'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export const DEFAULT_MAIL_LOCALE: MailLocale = 'zh-TW';

/** 使用者偏好（`users.locale`）→ 信件語系；不認識的值退回預設。 */
export function toMailLocale(value: string | null | undefined): MailLocale {
  return MAIL_LOCALES.find((locale) => locale === value) ?? DEFAULT_MAIL_LOCALE;
}

/** 所有信共用的頁尾。 */
export const MAIL_FOOTER = {
  'zh-TW': '這是 B2B System 自動寄出的信，請勿直接回覆。',
  'en-US': 'This is an automated message from B2B System. Please do not reply.',
} as const satisfies Record<MailLocale, string>;
