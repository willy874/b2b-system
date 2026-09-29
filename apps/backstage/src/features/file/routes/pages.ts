import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';

import { FILE_LOCALE_SCOPE } from '../locale';
import { WorkspaceRoute } from './external';
import { DEFAULT_FILE_SEARCH, FileSearchQuerySchema } from './model';

/** 檔案管理器在工作區底下：`/w/:workspaceSlug/file`（docs/adr/0018-workspace-tenancy.md D7、D17）。 */
export const FileListRoute = createRoute({
  getParentRoute: () => WorkspaceRoute,
  path: 'file',
  loader: localeScopeLoader(FILE_LOCALE_SCOPE),
  validateSearch: FileSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_FILE_SEARCH)] },
});
