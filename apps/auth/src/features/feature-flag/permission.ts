import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { FeatureFlagListRoute } from './routes/pages';

/** 試行開關的列表；`featureFlag:update` 才能切換全平台的狀態（hooks/useFeatureFlagPermission.ts）。 */
export const FEATURE_FLAG_PAGE = definePageKey('FEATURE_FLAG');

export function registerFeatureFlagPagePermissions(): void {
  registerPagePermission(FEATURE_FLAG_PAGE, {
    route: routeBasePath(FeatureFlagListRoute),
    rule: {
      resource: PermissionResource.FEATURE_FLAG,
      access: [PermissionKey['featureFlag:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
