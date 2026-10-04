import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 租戶使用者的帳號政策（docs/architecture/backend/12-settings.md §3）。
 * 平台管理者（apps/platform）不讀這些，沿用 env 的 `LOGIN_*` 與程式常數。
 */

/** 連續登入失敗幾次就鎖定。下限 3：設成 0 或 1 等於關掉保護或讓人一打錯就被鎖。 */
export const LOGIN_MAX_ATTEMPTS_SETTING = defineSetting({
  key: 'auth.loginMaxAttempts',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(3).max(20),
  defaultValue: 5,
  isPublic: false,
});

/** 鎖定多久（秒）：1 分鐘到 1 天。 */
export const LOGIN_LOCKOUT_SECONDS_SETTING = defineSetting({
  key: 'auth.loginLockoutSeconds',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(60).max(86_400),
  defaultValue: 900,
  isPublic: false,
});

/**
 * 密碼最短長度。只能比 `PasswordSchema` 的 12 更嚴：DTO 先以 12 擋，service 再依這個值檢查。
 * 公開：註冊、啟用、重設密碼的頁面要提示長度。
 */
export const PASSWORD_MIN_LENGTH_SETTING = defineSetting({
  key: 'auth.passwordMinLength',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(12).max(64),
  defaultValue: 12,
  isPublic: true,
});

/** 是否開放註冊申請；關閉時 `POST /auth/register` 回 404，登入頁不顯示註冊入口。 */
export const REGISTRATION_ENABLED_SETTING = defineSetting({
  key: 'auth.registrationEnabled',
  category: SettingCategory.AUTH,
  schema: z.boolean(),
  defaultValue: true,
  isPublic: true,
});

/** 啟用信連結的有效時數。信裡寫「N 小時內有效」，所以以小時為單位。 */
export const ACTIVATION_TTL_HOURS_SETTING = defineSetting({
  key: 'auth.activationTtlHours',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(1).max(168),
  defaultValue: 24,
  isPublic: false,
});

/** 重設密碼連結的有效時數。 */
export const PASSWORD_RESET_TTL_HOURS_SETTING = defineSetting({
  key: 'auth.passwordResetTtlHours',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(1).max(24),
  defaultValue: 1,
  isPublic: false,
});

export const AUTH_SETTINGS = [
  LOGIN_MAX_ATTEMPTS_SETTING,
  LOGIN_LOCKOUT_SECONDS_SETTING,
  PASSWORD_MIN_LENGTH_SETTING,
  REGISTRATION_ENABLED_SETTING,
  ACTIVATION_TTL_HOURS_SETTING,
  PASSWORD_RESET_TTL_HOURS_SETTING,
];
