import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
import { usePermission } from '@/core/permission';
import type { Permission } from '@/shared/api-sdk';

/**
 * 反提權的前端過濾。
 * `blocked` 顯示為 disabled ＋ tooltip，不是隱藏——隱藏會讓管理員以為
 * 系統沒有這個權限。真正的防線是後端的 AUTHZ_ESCALATION 檢查。
 */
export function useGrantablePermissions() {
  const { permissions: mine } = usePermission();
  const { data, isPending } = useQuery(getPermissionListQueryOptions());

  return useMemo(() => {
    const items: Permission[] = data?.items ?? [];
    return {
      loading: isPending,
      groups: data?.groups ?? [],
      items,
      grantable: items.filter((item) => mine.has(item.key)),
      blocked: items.filter((item) => !mine.has(item.key)),
      isGrantable: (key: string) => mine.has(key as never),
    };
  }, [data, isPending, mine]);
}
