import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { OrganizationRoute, OrgUnitImportRoute, OrgUnitMemberImportRoute } from './routes/pages';

export const ORG_UNIT_PAGE = definePageKey('ORG_UNIT');
/** 部門匯入：修改模式要 `orgUnit:update`（`orgUnit:create` 包含它，docs/architecture/backend/22-data-transfer.md §12.3）。 */
export const ORG_UNIT_IMPORT_PAGE = definePageKey('ORG_UNIT_IMPORT');
/** 部門成員匯入：`orgUnit:update`，挑成員要看得到使用者。 */
export const ORG_UNIT_MEMBER_IMPORT_PAGE = definePageKey('ORG_UNIT_MEMBER_IMPORT');

export function registerOrganizationPagePermissions(): void {
  // 不帶 `resource`：app 的 `PermissionResource` 還沒有 `orgUnit`，create／update／delete 由
  // `useOrgUnitPermission` 直接以權限鍵判斷
  registerPagePermission(ORG_UNIT_PAGE, {
    route: routeBasePath(OrganizationRoute), // '/organization'
    rule: { access: [PermissionKey['orgUnit:read']], match: PermissionMatch.EVERY },
  });
  registerPagePermission(ORG_UNIT_IMPORT_PAGE, {
    route: routeBasePath(OrgUnitImportRoute),
    rule: {
      access: [PermissionKey['orgUnit:read'], PermissionKey['orgUnit:update']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(ORG_UNIT_MEMBER_IMPORT_PAGE, {
    route: routeBasePath(OrgUnitMemberImportRoute),
    rule: {
      access: [
        PermissionKey['orgUnit:read'],
        PermissionKey['orgUnit:update'],
        PermissionKey['user:read'],
      ],
      match: PermissionMatch.EVERY,
    },
  });
}
