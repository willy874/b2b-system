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
      access: [PermissionKey['file:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
