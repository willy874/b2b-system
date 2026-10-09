import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { CdnRoute } from './routes/pages';

/** CDN 頁面；`cdn:update` 改設定、`cdn:purge` 清理、`cdn:purgeAll` 清空整個快取（docs/architecture/iam/02-permission-catalog.md §8）。 */
export const CDN_PAGE = definePageKey('CDN');

export function registerCdnPagePermissions(): void {
  registerPagePermission(CDN_PAGE, {
    route: routeBasePath(CdnRoute),
    rule: {
      resource: PermissionResource.CDN,
      access: [PermissionKey['cdn:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
