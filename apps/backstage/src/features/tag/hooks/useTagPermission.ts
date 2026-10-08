import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';
import { TenantFeature } from '@/shared/api-sdk';

import { TAG_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()（docs/architecture/backend/18-tag.md §7.2 D5）。 */
export function useTagPermission() {
  const page = usePagePermission(TAG_PAGE);
  const { can } = usePermission();
  const hasDataTransfer = useIsFeatureReady(TenantFeature.dataTransfer);
  return useMemo(
    () => ({
      ...page,
      /** 匯出要獨立的 `tag:export`（docs/architecture/backend/22-data-transfer.md §13 D11）；租戶沒有啟用 `dataTransfer` 時沒有入口 */
      canExport: hasDataTransfer && can(PermissionKey['tag:export']),
      /** 匯入沿用 create／update：修改模式要 `tag:update`（`tag:create` 包含它） */
      canImport: hasDataTransfer && page.canUpdate,
    }),
    [page, can, hasDataTransfer],
  );
}
