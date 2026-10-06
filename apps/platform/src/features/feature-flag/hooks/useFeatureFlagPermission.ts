import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { FEATURE_FLAG_PAGE } from '../permission';

/** 試行開關頁的權限 facade：`featureFlag:read` 進頁面，`featureFlag:update` 才能切換。 */
export function useFeatureFlagPermission() {
  const page = usePagePermission(FEATURE_FLAG_PAGE);
  const { can } = usePermission();
  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({ ...page, canUpdate: can(PermissionKey['featureFlag:update']) }),
    [page, can],
  );
}
