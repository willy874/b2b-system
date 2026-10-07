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
 * IANA 時區名稱：租戶的預設時區與使用者的時區偏好共用。前端遇到不合法的值會退回預設，
 * 但公告的週期計算與寄信的日期格式化會直接拋 RangeError，所以在寫入時就擋下。
 */
export const TimeZoneSchema = z.string().trim().min(1).max(64).refine(isTimeZone, {
  message: 'must be an IANA time zone',
});

/**
 * 租戶的預設時區（IANA 名稱）：公告的週期依它計算（docs/architecture/backend/19-announcement.md §9.2 D11）。
 * 畫面上的時間用使用者自己的時區偏好，不讀它（docs/architecture/backend/12-settings.md §5.3）。
 * 定義放在 core：登記仍由 `modules/system` 負責，其他模組只讀它的值。
 */
export const DEFAULT_TIMEZONE_SETTING = defineSetting({
  key: 'general.defaultTimezone',
  category: SettingCategory.GENERAL,
  schema: TimeZoneSchema,
  defaultValue: 'Asia/Taipei',
  isPublic: true,
});
