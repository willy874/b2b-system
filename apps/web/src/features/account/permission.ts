import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { PreferenceRoute, ProfileRoute } from './routes/pages';

/** 個人範圍的頁面：對象是自己，不需要權限。 */
export const PROFILE_PAGE = definePageKey('PROFILE');
export const PREFERENCE_PAGE = definePageKey('PREFERENCE');

export function registerAccountPagePermissions(): void {
  registerPagePermission(PROFILE_PAGE, {
    route: routeBasePath(ProfileRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
  registerPagePermission(PREFERENCE_PAGE, {
    route: routeBasePath(PreferenceRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
