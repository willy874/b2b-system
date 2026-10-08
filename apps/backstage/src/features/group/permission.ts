import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import {
  GroupCreateRoute,
  GroupImportRoute,
  GroupListRoute,
  GroupMemberImportRoute,
} from './routes/pages';

export const GROUP_PAGE = definePageKey('GROUP');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const GROUP_CREATE_PAGE = definePageKey('GROUP_CREATE');
/** 匯入頁：修改模式要 `group:update`（`group:create` 包含它，docs/architecture/backend/22-data-transfer.md §12.2）。 */
export const GROUP_IMPORT_PAGE = definePageKey('GROUP_IMPORT');
/** 成員匯入：加成員要 `group:update`，挑成員要看得到使用者。 */
export const GROUP_MEMBER_IMPORT_PAGE = definePageKey('GROUP_MEMBER_IMPORT');

export function registerGroupPagePermissions(): void {
  registerPagePermission(GROUP_PAGE, {
    route: routeBasePath(GroupListRoute), // '/group'
    rule: {
      resource: PermissionResource.GROUP,
      access: [PermissionKey['group:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(GROUP_CREATE_PAGE, {
    route: routeBasePath(GroupCreateRoute),
    rule: {
      resource: PermissionResource.GROUP,
      access: [PermissionKey['group:read'], PermissionKey['group:create']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(GROUP_IMPORT_PAGE, {
    route: routeBasePath(GroupImportRoute),
    rule: {
      resource: PermissionResource.GROUP,
      access: [PermissionKey['group:read'], PermissionKey['group:update']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(GROUP_MEMBER_IMPORT_PAGE, {
    route: routeBasePath(GroupMemberImportRoute),
    rule: {
      resource: PermissionResource.GROUP,
      access: [
        PermissionKey['group:read'],
        PermissionKey['group:update'],
        PermissionKey['user:read'],
      ],
      match: PermissionMatch.EVERY,
    },
  });
}
