import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 匯出檔與匯入套用列的保留天數，從完成時起算；到期由 `dataTransfer.cleanup` 清除（docs/architecture/backend/22-data-transfer.md §10、§13 D12）。
 */
export const DATA_TRANSFER_RETENTION_DAYS_SETTING = defineSetting({
  key: 'dataTransfer.retentionDays',
  category: SettingCategory.DATA_TRANSFER,
  schema: z.number().int().min(1).max(30),
  defaultValue: 7,
  isPublic: false,
});

export const DATA_TRANSFER_SETTINGS = [DATA_TRANSFER_RETENTION_DAYS_SETTING];
