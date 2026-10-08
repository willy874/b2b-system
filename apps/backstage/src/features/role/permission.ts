import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { RoleCreateRoute, RoleImportRoute, RoleListRoute } from './routes/pages';

export const ROLE_PAGE = definePageKey('ROLE');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const ROLE_CREATE_PAGE = definePageKey('ROLE_CREATE');
/** 匯入頁：修改模式要 `role:update`（`role:create` 包含它）；頁內依權限決定可以切換的模式（docs/architecture/backend/22-data-transfer.md §12.1）。 */
export const ROLE_IMPORT_PAGE = definePageKey('ROLE_IMPORT');

export function registerRolePagePermissions(): void {
  registerPagePermission(ROLE_PAGE, {
    route: routeBasePath(RoleListRoute), // '/role'
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(ROLE_CREATE_PAGE, {
    route: routeBasePath(RoleCreateRoute),
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read'], PermissionKey['role:create']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(ROLE_IMPORT_PAGE, {
    route: routeBasePath(RoleImportRoute),
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read'], PermissionKey['role:update']],
      match: PermissionMatch.EVERY,
    },
  });
}
