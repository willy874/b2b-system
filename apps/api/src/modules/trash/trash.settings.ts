import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 回收桶的保留天數：軟刪除超過這麼久的列由 `trash.purge` 永久刪除（ADR-0025 D11）。
 * 下限 1 天：刪除後至少有一天可以救回；上限 365 天。
 */
export const TRASH_RETENTION_DAYS_SETTING = defineSetting({
  key: 'trash.retentionDays',
  category: SettingCategory.TRASH,
  schema: z.number().int().min(1).max(365),
  defaultValue: 30,
  isPublic: false,
});

export const TRASH_SETTINGS = [TRASH_RETENTION_DAYS_SETTING];
