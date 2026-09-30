import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { RootRoute } from '@/core/router';
import { trashLocaleLoader } from '@/core/trash';

import { TRASH_LOCALE_SCOPE } from '../locale';
import { DEFAULT_TRASH_SEARCH, TrashSearchQuerySchema } from './model';

/** 回收桶（docs/architecture/frontend/13-trash.md）：一次看一種資源類型，類型由各 feature 登記。 */
export const TrashListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/trash',
  loader: trashLocaleLoader(TRASH_LOCALE_SCOPE),
  validateSearch: TrashSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TRASH_SEARCH)] },
});
