import { z } from 'zod';

import { defineSetting, SettingCategory } from './setting-definition';

/** 是不是 `Intl` 認得的 IANA 時區（`Asia/Taipei`、`UTC`…）。 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    // 不認得的時區會拋 RangeError：那就是不合法的值
    return false;
  }
}

/**
 * 租戶的預設時區（IANA 名稱）：使用者沒有設定時區偏好時用它顯示時間；公告的週期也依它計算
 * （docs/adr/0031-announcements.md D11）。公開：前端在登入前就要用它顯示時間。
 * 定義放在 core：登記仍由 `modules/system` 負責，其他模組只讀它的值。
 */
export const DEFAULT_TIMEZONE_SETTING = defineSetting({
  key: 'general.defaultTimezone',
  category: SettingCategory.GENERAL,
  schema: z.string().trim().min(1).max(64).refine(isTimeZone),
  defaultValue: 'Asia/Taipei',
  isPublic: true,
});
