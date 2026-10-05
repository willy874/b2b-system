import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { trashLocaleLoader } from '@/core/trash';

import { TRASH_LOCALE_SCOPE } from '../locale';
import { DEFAULT_TRASH_SEARCH, TrashSearchQuerySchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/05-tenancy.md §12）。 */
export const TRASH_FEATURE = 'trash';

/** 回收桶（docs/architecture/frontend/13-trash.md）：一次看一種資源類型，類型由各 feature 登記。 */
export const TrashListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/trash',
  beforeLoad: requireFeature(TRASH_FEATURE),
  loader: trashLocaleLoader(TRASH_LOCALE_SCOPE),
  validateSearch: TrashSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TRASH_SEARCH)] },
});
