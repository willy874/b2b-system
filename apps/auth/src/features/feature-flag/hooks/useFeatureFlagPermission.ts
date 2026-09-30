import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { FEATURE_FLAG_PAGE } from '../permission';

/** 試行開關頁的權限 facade：`featureFlag:read` 進頁面，`featureFlag:update` 才能切換。 */
export function useFeatureFlagPermission() {
  const page = usePagePermission(FEATURE_FLAG_PAGE);
  const { can } = usePermission();
  return { ...page, canUpdate: can(PermissionKey['featureFlag:update']) };
}
