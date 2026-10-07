import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { DataTransferListRoute } from './routes/pages';

/** 自己的匯入匯出：只需要登入（只看得到自己建立的；下載當下另看該資源的匯出權限，docs/architecture/backend/22-data-transfer.md §9.1）。 */
export const DATA_TRANSFER_PAGE = definePageKey('DATA_TRANSFER');

export function registerDataTransferPagePermissions(): void {
  registerPagePermission(DATA_TRANSFER_PAGE, {
    route: routeBasePath(DataTransferListRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
