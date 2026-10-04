import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

import { TenantDetailRoute } from '../../routes';
import type { TenantDetailTab } from '../../routes';

/**
 * 詳情頁的分頁，狀態放在網址的 `tab`。試行開關的目錄需要 `featureFlag:read`（docs/architecture/05-tenancy.md §11.2 D8），
 * 沒有這個權限（或權限還沒水合）時不提供這一頁，網址指向它也回到概覽。
 */
export function useTenantDetailTab() {
  const { id } = TenantDetailRoute.useParams();
  const { tab } = TenantDetailRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  const canReadFlags = can(PermissionKey['featureFlag:read']);

  const tabs: TenantDetailTab[] = canReadFlags
    ? ['overview', 'features', 'flags']
    : ['overview', 'features'];
  const active: TenantDetailTab = tabs.includes(tab) ? tab : 'overview';

  const setTab = useCallback(
    (next: TenantDetailTab) =>
      void navigate({ to: TenantDetailRoute.to, params: { id }, search: { tab: next } }),
    [id, navigate],
  );

  return { tabs, active, setTab };
}
