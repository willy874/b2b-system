import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
import { isPermissionKey, usePermission } from '@/core/permission';
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
      // 技能樹的節點 id 是字串：先收窄成權限鍵（群組節點等非權限鍵一律不可授予）
      isGrantable: (key: string) => isPermissionKey(key) && mine.has(key),
    };
  }, [data, isPending, mine]);
}
