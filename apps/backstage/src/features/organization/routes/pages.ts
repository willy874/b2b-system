import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { ORGANIZATION_LOCALE_SCOPE } from '../locale';
import { OrganizationSearchSchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/backend/23-organization.md §6）。 */
export const ORGANIZATION_FEATURE = 'organization';

/** 左側部門樹、右側選中部門的詳情；選中的部門放在網址（`?unitId=`），可分享、上一頁回到前一個部門。 */
export const OrganizationRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/organization',
  staticData: { titleKey: 'menu.organization' },
  beforeLoad: requireFeature(ORGANIZATION_FEATURE),
  loader: localeScopeLoader(ORGANIZATION_LOCALE_SCOPE),
  validateSearch: OrganizationSearchSchema,
});
