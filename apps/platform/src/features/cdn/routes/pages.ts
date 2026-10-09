import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { CDN_LOCALE_SCOPE } from '../locale';

/** CDN 的執行期設定、邊緣節點與手動清理（`cdn:read`，docs/architecture/backend/09-file.md §16.12）。 */
export const CdnRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/cdn',
  staticData: { titleKey: 'menu.cdn' },
  loader: localeScopeLoader(CDN_LOCALE_SCOPE),
});
