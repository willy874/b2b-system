import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { TagListRoute } from './routes/pages';

/** 標籤管理：持有任一個管理定義的權限鍵就能進（沒有 `tag:read`，docs/adr/0032-tags.md D5）。 */
export const TAG_PAGE = definePageKey('TAG');

export function registerTagPagePermissions(): void {
  registerPagePermission(TAG_PAGE, {
    route: routeBasePath(TagListRoute), // '/tag'
    rule: {
      resource: PermissionResource.TAG,
      access: [
        PermissionKey['tag:create'],
        PermissionKey['tag:update'],
        PermissionKey['tag:delete'],
      ],
      match: PermissionMatch.SOME,
    },
  });
}
