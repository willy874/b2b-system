import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { JOB_PAGE } from '../permission';

/** 背景工作頁的權限 facade：`platformJob:read` 進頁面，`platformJob:retry` 才顯示重試。 */
export function useJobPermission() {
  const page = usePagePermission(JOB_PAGE);
  const { can } = usePermission();
  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({ ...page, canRetry: can(PermissionKey['platformJob:retry']) }),
    [page, can],
  );
}
