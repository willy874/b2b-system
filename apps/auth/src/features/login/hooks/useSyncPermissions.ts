import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { useHasSession } from '@/core/auth';
import { usePermissionStore } from '@/core/store';

/**
 * 權限集合的水合：Query 負責取得與新鮮度，store 負責同步讀取，useEffect 是橋。
 * 掛在 app/App.tsx，整個 app 只有一個實例。
 *
 * 權限是平台管理者的角色對應的平台權限（docs/rbac/02-permission-catalog.md §8）。
 */
export function useSyncPermissions() {
  const setPermissions = usePermissionStore((state) => state.setPermissions);
  const hasSession = useHasSession();
  const { data, isPending } = useQuery({
    ...getAuthProfileQueryOptions(),
    enabled: hasSession,
  });

  useEffect(() => {
    if (data) setPermissions(data.permissions);
  }, [data, setPermissions]);

  return { profile: data, loading: isPending };
}
