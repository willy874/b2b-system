import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 一次發送最多幾位收件人（docs/adr/0031-announcements.md D6）：超過時那次發送失敗並在詳情顯示原因，**不截斷**——
 * 截斷會讓「誰沒收到」變得不可預期。放在通知的分類下（與保留天數、每人上限同一頁）。
 */
export const ANNOUNCEMENT_MAX_RECIPIENTS_SETTING = defineSetting({
  key: 'announcement.maxRecipients',
  category: SettingCategory.NOTIFICATION,
  schema: z.number().int().min(100).max(100_000),
  defaultValue: 10_000,
  isPublic: false,
});

export const ANNOUNCEMENT_SETTINGS = [ANNOUNCEMENT_MAX_RECIPIENTS_SETTING];
