import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

import { API_TOKEN_MAX_LIFETIME_DAYS } from './api-token.constants';

/** 個人 API token 的到期上限（天）：只能在平台上限以內調短（docs/architecture/06-external-api.md §9.2 D8）。 */
export const PERSONAL_TOKEN_MAX_DAYS_SETTING = defineSetting({
  key: 'auth.personalTokenMaxDays',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(1).max(API_TOKEN_MAX_LIFETIME_DAYS.human),
  defaultValue: API_TOKEN_MAX_LIFETIME_DAYS.human,
  isPublic: false,
});

/** 服務帳號 API token 的到期上限（天）。 */
export const SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING = defineSetting({
  key: 'auth.serviceAccountTokenMaxDays',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(1).max(API_TOKEN_MAX_LIFETIME_DAYS.service),
  defaultValue: API_TOKEN_MAX_LIFETIME_DAYS.service,
  isPublic: false,
});

export const API_TOKEN_SETTINGS = [
  PERSONAL_TOKEN_MAX_DAYS_SETTING,
  SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING,
];
