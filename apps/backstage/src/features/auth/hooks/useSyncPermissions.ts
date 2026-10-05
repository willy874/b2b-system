import { useHasSession } from '@b2b-system/web-core/auth';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import type { PermissionKey } from '@/core/permission';

/**
 * 權限集合的水合：Query 負責取得與新鮮度，store 負責同步讀取，useEffect 是橋。
 * 掛在 app/App.tsx，整個 app 只有一個實例。
 */
export function useSyncPermissions() {
  const setPermissions = usePermissionStore((state) => state.setPermissions);
  const hasSession = useHasSession();
  const { data, isPending, error, refetch } = useQuery({
    ...getAuthProfileQueryOptions(),
    enabled: hasSession,
  });

  useEffect(() => {
    if (data) setPermissions(data.permissions as PermissionKey[]);
  }, [data, setPermissions]);

  return { profile: data, loading: isPending, error, refetch };
}
