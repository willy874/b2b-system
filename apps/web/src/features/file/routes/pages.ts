import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { FILE_LOCALE_SCOPE } from '../locale';
import { DEFAULT_FILE_SEARCH, FileSearchQuerySchema } from './model';

export const FileListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/file',
  loader: localeScopeLoader(FILE_LOCALE_SCOPE),
  validateSearch: FileSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_FILE_SEARCH)] },
});
