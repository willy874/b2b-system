import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { JOB_PAGE } from '../permission';

/** 背景工作頁的權限 facade：`job:read` 進頁面，`job:retry` 才顯示重試。 */
export function useJobPermission() {
  const page = usePagePermission(JOB_PAGE);
  const { can } = usePermission();
  return { ...page, canRetry: can(PermissionKey['job:retry']) };
}
