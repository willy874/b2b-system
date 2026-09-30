import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { IDENTITY_PROVIDER_LOCALE_SCOPE } from '../locale';

/**
 * 這個租戶的外部 IdP 連線（`identityProvider:read`，docs/adr/0019-sso-identity-platform.md D8–D11）：
 * OIDC 連線、email 網域與找不到帳號時的處理方式。client secret 只寫不讀。
 * 連線屬於租戶，由租戶的管理者在 backstage 管理（docs/adr/0020-physical-tenant-isolation.md D18、D22）。
 */
export const IdentityProviderListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/identity-provider',
  loader: localeScopeLoader(IDENTITY_PROVIDER_LOCALE_SCOPE),
});
