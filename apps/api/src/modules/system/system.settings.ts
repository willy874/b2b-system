import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    // 不認得的時區會拋 RangeError：那就是不合法的值
    return false;
  }
}

/** 使用者沒有設定時區偏好時用的預設時區（IANA 名稱）。公開：前端在登入前就要用它顯示時間。 */
export const DEFAULT_TIMEZONE_SETTING = defineSetting({
  key: 'general.defaultTimezone',
  category: SettingCategory.GENERAL,
  schema: z.string().trim().min(1).max(64).refine(isTimeZone),
  defaultValue: 'Asia/Taipei',
  isPublic: true,
});

export const SYSTEM_SETTINGS = [DEFAULT_TIMEZONE_SETTING];
