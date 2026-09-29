import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
import { usePermission } from '@/core/permission';
import type { Permission, PermissionScope } from '@/shared/api-sdk';

/**
 * 反提權的前端過濾，只列 `scope` 範圍的權限鍵（角色只能含同範圍的鍵）。
 * `blocked` 顯示為 disabled ＋ tooltip，不是隱藏——隱藏會讓管理員以為
 * 系統沒有這個權限。真正的防線是後端的 AUTHZ_ESCALATION 檢查。
 * 工作區範圍的鍵在角色定義上不檢查反提權：授予發生在指派到工作區時
 * （docs/adr/0018-workspace-tenancy.md D3）。
 */
export function useGrantablePermissions(scope: PermissionScope) {
  const { permissions: mine } = usePermission();
  const { data, isPending } = useQuery(getPermissionListQueryOptions());

  return useMemo(() => {
    const items: Permission[] = (data?.items ?? []).filter((item) => item.scope === scope);
    const inScope = new Set(items.map((item) => String(item.key)));
    const isGrantable = (key: string) => scope === 'workspace' || mine.has(key as never);
    return {
      loading: isPending,
      groups: (data?.groups ?? [])
        .map((group) => ({ ...group, keys: group.keys.filter((key) => inScope.has(key)) }))
        .filter((group) => group.keys.length > 0),
      items,
      grantable: items.filter((item) => isGrantable(item.key)),
      blocked: items.filter((item) => !isGrantable(item.key)),
      isGrantable,
    };
  }, [data, isPending, mine, scope]);
}
