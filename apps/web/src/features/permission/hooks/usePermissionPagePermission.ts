import { usePagePermission } from '@/core/permission';

import { PERMISSION_PAGE } from '../permission';

/** 權限目錄是唯讀的：只有 canAccess 有意義。 */
export function usePermissionPagePermission() {
  return usePagePermission(PERMISSION_PAGE);
}
