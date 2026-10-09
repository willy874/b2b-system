import type { MfaPurpose } from '@/core/mfa';

/**
 * 驗證碼簡訊的內容。簡訊按則計費、70 個中文字（160 個英數）一則：只放必要的資訊。
 * 帳號語系是中文時用中文，其他用英文。
 */
export function smsCodeText(input: {
  locale: string;
  issuer: string;
  code: string;
  minutes: number;
  purpose: MfaPurpose;
}): string {
  if (input.locale.toLowerCase().startsWith('zh')) {
    return `【${input.issuer}】驗證碼 ${input.code}，${input.minutes} 分鐘內有效。請勿提供給任何人。`;
  }
  return `[${input.issuer}] Your verification code is ${input.code}. It expires in ${input.minutes} minutes. Never share it.`;
}

/** E.164 的手機號碼：`+` 國碼 號碼，共 8～15 位數字。 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** 遮蔽的號碼：留國碼的前幾碼與最後 3 碼（`+8869*****678`）。 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 8)}${phone.slice(-3)}`;
}

/** 平台參數 `allowedCountryCodes`（以逗號分隔的國碼，例：`886,852`）→ 國碼清單。 */
export function parseCountryCodes(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\s]+/)
    .map((code) => code.replace(/^\+/, '').trim())
    .filter((code) => /^[1-9]\d{0,3}$/.test(code));
}

export function isAllowedCountry(phone: string, codes: readonly string[]): boolean {
  return codes.some((code) => phone.startsWith(`+${code}`));
}
