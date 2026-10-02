import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { TAG_LOCALE_SCOPE } from '../locale';
import { DEFAULT_TAG_SEARCH, TagSearchQuerySchema } from './model';

/** 標籤管理（docs/architecture/backend/18-tag.md §7.2 D5）：每個標籤組一個分頁，`?scope=`。 */
export const TagListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tag',
  loader: localeScopeLoader(TAG_LOCALE_SCOPE),
  validateSearch: TagSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TAG_SEARCH)] },
});
