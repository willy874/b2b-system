import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { IDENTITY_PROVIDER_LOCALE_SCOPE } from '../locale';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/05-tenancy.md §12）。 */
export const IDENTITY_PROVIDER_FEATURE = 'identityProvider';

/**
 * 這個租戶的外部 IdP 連線（`identityProvider:read`，docs/architecture/04-sso.md §12.2 D8–D11）：
 * OIDC 連線、email 網域與找不到帳號時的處理方式。client secret 只寫不讀。
 * 連線屬於租戶，由租戶的管理者在 backstage 管理（docs/architecture/05-tenancy.md §10.2 D18）；
 * 平台管理者可對租戶關閉整個功能。
 */
export const IdentityProviderListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/identity-provider',
  beforeLoad: requireFeature(IDENTITY_PROVIDER_FEATURE),
  loader: localeScopeLoader(IDENTITY_PROVIDER_LOCALE_SCOPE),
});
