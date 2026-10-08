import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod';

import { requireFeature } from '@/core/feature';

import { TAG_LOCALE_SCOPE } from '../locale';
import { DEFAULT_TAG_SEARCH, TagSearchQuerySchema } from './model';

/** 標籤管理（docs/architecture/backend/18-tag.md §7.2 D5）：每個標籤組一個分頁，`?scope=`。 */
export const TagListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tag',
  staticData: { titleKey: 'menu.tag' },
  loader: localeScopeLoader(TAG_LOCALE_SCOPE),
  validateSearch: TagSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TAG_SEARCH)] },
});

/** 匯入頁的網址：模式與已送出的傳輸（重新整理或從通知回來時直接顯示結果，docs/architecture/backend/22-data-transfer.md §7.2）。 */
export const TagImportSearchSchema = z.object({
  mode: z.enum(['create', 'update']).catch('create'),
  transfer: z.string().uuid().optional().catch(undefined),
});

/**
 * 標籤匯入（docs/architecture/backend/22-data-transfer.md §12.4）：標籤組是每一列的欄位，一份檔案可以有多個組。
 * 全頁，掛在根下；屬於可啟用的 `dataTransfer`，未啟用時 404。
 */
export const TagImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tag/import',
  staticData: { titleKey: 'menu.tagImport' },
  beforeLoad: requireFeature('dataTransfer'),
  loader: localeScopeLoader(TAG_LOCALE_SCOPE),
  validateSearch: TagImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});
