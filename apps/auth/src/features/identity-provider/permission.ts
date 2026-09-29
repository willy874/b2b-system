import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { IdentityProviderListRoute } from './routes/pages';

/** 平台的外部 IdP 連線管理。 */
export const IDENTITY_PROVIDER_PAGE = definePageKey('IDENTITY_PROVIDER');

export function registerIdentityProviderPagePermissions(): void {
  registerPagePermission(IDENTITY_PROVIDER_PAGE, {
    route: routeBasePath(IdentityProviderListRoute),
    rule: {
      resource: PermissionResource.IDENTITY_PROVIDER,
      access: [PermissionKey['identityProvider:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
