import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { useHasSession } from '@/core/auth';
import type { PermissionKey } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

/**
 * 權限集合的水合：Query 負責取得與新鮮度，store 負責同步讀取，useEffect 是橋。
 * 掛在 app/App.tsx，整個 app 只有一個實例。
 *
 * 平台管理者還沒有權限目錄（交付順序第 4 步加上租戶管理時才有）：登入後水合成空集合，
 * 頁面權限守衛照常運作，沒有任何受限的頁面。
 */
export function useSyncPermissions() {
  const setPermissions = usePermissionStore((state) => state.setPermissions);
  const hasSession = useHasSession();
  const { data, isPending } = useQuery({
    ...getAuthProfileQueryOptions(),
    enabled: hasSession,
  });

  useEffect(() => {
    if (data) setPermissions([] as PermissionKey[]);
  }, [data, setPermissions]);

  return { profile: data, loading: isPending };
}
