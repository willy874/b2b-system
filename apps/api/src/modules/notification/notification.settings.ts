import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 已讀的通知保留幾天：已讀超過這麼久的由 `notification.cleanup` 刪除（ADR-0026 D10）。
 * 未讀的不受影響（只受 `notification.maxPerUser` 限制）。1～365 天。
 */
export const NOTIFICATION_RETENTION_DAYS_SETTING = defineSetting({
  key: 'notification.retentionDays',
  category: SettingCategory.NOTIFICATION,
  schema: z.number().int().min(1).max(365),
  defaultValue: 30,
  isPublic: false,
});

/**
 * 每人最多保留幾則通知：超過的最舊通知（不論已讀與否）由 `notification.cleanup` 刪除（D10）。
 * 下限 10：頂列的列表至少有東西可看；上限 5000：列表與未讀數的查詢都以收件人為範圍，量要有上限。
 */
export const NOTIFICATION_MAX_PER_USER_SETTING = defineSetting({
  key: 'notification.maxPerUser',
  category: SettingCategory.NOTIFICATION,
  schema: z.number().int().min(10).max(5000),
  defaultValue: 500,
  isPublic: false,
});

export const NOTIFICATION_SETTINGS = [
  NOTIFICATION_RETENTION_DAYS_SETTING,
  NOTIFICATION_MAX_PER_USER_SETTING,
];
