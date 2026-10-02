import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 一次發送最多幾位收件人（docs/architecture/backend/19-announcement.md §9.2 D6）：超過時那次發送失敗並在詳情顯示原因，**不截斷**——
 * 截斷會讓「誰沒收到」變得不可預期。放在通知的分類下（與保留天數、每人上限同一頁）。
 */
export const ANNOUNCEMENT_MAX_RECIPIENTS_SETTING = defineSetting({
  key: 'announcement.maxRecipients',
  category: SettingCategory.NOTIFICATION,
  schema: z.number().int().min(100).max(100_000),
  defaultValue: 10_000,
  isPublic: false,
});

/**
 * 發送紀錄保留幾天（D19）：建立超過這麼久、已經結束的發送紀錄由每日維護刪除（週期公告每次發送都留一筆）。
 * 刪掉之後收件人點舊通知看不到全文。
 */
export const ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING = defineSetting({
  key: 'announcement.dispatchRetentionDays',
  category: SettingCategory.NOTIFICATION,
  schema: z.number().int().min(30).max(3650),
  defaultValue: 365,
  isPublic: false,
});

export const ANNOUNCEMENT_SETTINGS = [
  ANNOUNCEMENT_MAX_RECIPIENTS_SETTING,
  ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING,
];
