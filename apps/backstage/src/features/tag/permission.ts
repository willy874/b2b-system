import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { TagImportRoute, TagListRoute } from './routes/pages';

/** 標籤管理：持有任一個管理定義的權限鍵就能進（沒有 `tag:read`，docs/architecture/backend/18-tag.md §7.2 D5）。 */
export const TAG_PAGE = definePageKey('TAG');
/** 匯入頁：修改模式要 `tag:update`（`tag:create` 包含它，docs/architecture/backend/22-data-transfer.md §12.4）。 */
export const TAG_IMPORT_PAGE = definePageKey('TAG_IMPORT');

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
  registerPagePermission(TAG_IMPORT_PAGE, {
    route: routeBasePath(TagImportRoute),
    rule: {
      resource: PermissionResource.TAG,
      access: [PermissionKey['tag:update']],
      match: PermissionMatch.EVERY,
    },
  });
}
