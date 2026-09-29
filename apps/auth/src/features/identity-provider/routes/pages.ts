import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { IDENTITY_PROVIDER_LOCALE_SCOPE } from '../locale';

/**
 * 平台的外部 IdP 連線（`identityProvider:read`，docs/adr/0019-sso-identity-platform.md D8–D11）：
 * OIDC 連線、email 網域與找不到帳號時的處理方式。client secret 只寫不讀。
 */
export const IdentityProviderListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/identity-providers',
  loader: localeScopeLoader(IDENTITY_PROVIDER_LOCALE_SCOPE),
});
