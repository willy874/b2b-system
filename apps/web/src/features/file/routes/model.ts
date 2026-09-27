import { z } from 'zod';

import { FILE_CATEGORIES } from '../constants';

/**
 * 網址只放「分享這個連結時對方也該看到的」：篩選、第幾頁、正在預覽的檔案。
 * 排列方式、閱覽模式、排序是個人偏好，放在 `preference.ts`（docs/architecture/frontend/12-file-manager.md §4）。
 */
export const FileSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  keyword: z.string().trim().max(100).optional().catch(undefined),
  category: z.enum(FILE_CATEGORIES).optional().catch(undefined),
  /** LightBox 開著的檔案 id。 */
  preview: z.string().uuid().optional().catch(undefined),
});

export type FileSearchQuery = z.infer<typeof FileSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_FILE_SEARCH: FileSearchQuery = { offset: 0 };
