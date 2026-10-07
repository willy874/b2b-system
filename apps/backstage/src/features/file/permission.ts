import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { FileListRoute } from './routes/pages';

export const FILE_PAGE = definePageKey('FILE');

export function registerFilePagePermissions(): void {
  registerPagePermission(FILE_PAGE, {
    route: routeBasePath(FileListRoute),
    rule: {
      resource: PermissionResource.FILE,
      // 只有資料夾授權的人（file:access）也進得來；看得到什麼由後端決定（docs/architecture/iam/06-resource-grants.md）
      access: [PermissionKey['file:access'], PermissionKey['file:read']],
      match: PermissionMatch.SOME,
    },
  });
}
