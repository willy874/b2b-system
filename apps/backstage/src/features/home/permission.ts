import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { HomeRoute } from './routes';

export const HOME_PAGE = definePageKey('HOME');

export function registerHomePagePermissions(): void {
  registerPagePermission(HOME_PAGE, {
    route: routeBasePath(HomeRoute),
    // 空陣列 = 任何已登入使用者都能進
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
