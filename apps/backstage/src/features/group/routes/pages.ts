import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod/mini';

import { requireFeature } from '@/core/feature';

import { GROUP_LOCALE_SCOPE } from '../locale';
import { DEFAULT_GROUP_SEARCH, GroupSearchQuerySchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/iam/07-groups.md §8）。 */
export const GROUP_FEATURE = 'group';

export const GroupListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/group',
  staticData: { titleKey: 'menu.userGroup' },
  beforeLoad: requireFeature(GROUP_FEATURE),
  loader: localeScopeLoader(GROUP_LOCALE_SCOPE),
  validateSearch: GroupSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_GROUP_SEARCH)] },
});

/** 對話框即路由：可分享網址、上一頁＝關閉對話框。 */
export const GroupCreateRoute = createRoute({
  getParentRoute: () => GroupListRoute,
  path: 'create',
  validateSearch: GroupSearchQuerySchema, // 保留列表的查詢條件
});

export const GroupDetailRoute = createRoute({
  getParentRoute: () => GroupListRoute,
  path: '$groupId',
});

/** 匯入頁的網址：模式與已送出的傳輸（重新整理或從通知回來時直接顯示結果，docs/architecture/backend/22-data-transfer.md §7.2）。 */
export const GroupImportSearchSchema = z.object({
  mode: z.catch(z.enum(['create', 'update']), 'create'),
  transfer: z.catch(z.optional(z.uuid()), undefined),
});

/** 群組與 `dataTransfer` 都要啟用（任一個關閉時 404）。 */
async function requireImportFeatures(): Promise<void> {
  await requireFeature(GROUP_FEATURE)();
  await requireFeature('dataTransfer')();
}

/**
 * 群組匯入（docs/architecture/backend/22-data-transfer.md §12.2）：全頁，掛在根下（不在列表頁的 Outlet 裡，也有自己的頁面權限）。
 */
export const GroupImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/group/import',
  staticData: { titleKey: 'menu.groupImport' },
  beforeLoad: requireImportFeatures,
  loader: localeScopeLoader(GROUP_LOCALE_SCOPE),
  validateSearch: GroupImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});

/** 群組成員匯入：只有新增模式（加成員）。 */
export const GroupMemberImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/group/import-members',
  staticData: { titleKey: 'menu.groupMemberImport' },
  beforeLoad: requireImportFeatures,
  loader: localeScopeLoader(GROUP_LOCALE_SCOPE),
  validateSearch: GroupImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});
