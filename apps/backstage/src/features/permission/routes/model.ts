import { z } from 'zod';

export const PERMISSION_VIEWS = ['list', 'tree'] as const;
export type PermissionView = (typeof PERMISSION_VIEWS)[number];

export const PERMISSION_HELD_FILTERS = ['held', 'notHeld'] as const;
export type PermissionHeldFilter = (typeof PERMISSION_HELD_FILTERS)[number];

/**
 * 檢視方式、篩選與樹狀圖選取的權限放在網址：分享「這個權限是什麼」的連結時對方看到同一個畫面。
 * 篩選對一覽表與樹狀圖同時作用。
 */
export const PermissionSearchQuerySchema = z.object({
  view: z.enum(PERMISSION_VIEWS).default('list').catch('list'),
  /** 比對權限名稱（目前語系）與權限鍵，不分大小寫。 */
  keyword: z.string().trim().max(100).optional().catch(undefined),
  /** 只看這些資源；網址上重複的 `resource` 成為陣列（`core/router/search.ts`）。 */
  resource: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
    .catch(undefined),
  held: z.enum(PERMISSION_HELD_FILTERS).optional().catch(undefined),
  /** 樹狀圖選取的權限鍵；目錄裡沒有的鍵由頁面忽略。 */
  key: z.string().max(100).optional().catch(undefined),
});

export type PermissionSearchQuery = z.infer<typeof PermissionSearchQuerySchema>;

export type PermissionFilters = Pick<PermissionSearchQuery, 'keyword' | 'resource' | 'held'>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_PERMISSION_SEARCH: PermissionSearchQuery = { view: 'list' };
