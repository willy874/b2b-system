import { useMemo, useState } from 'react';

import type { User } from '@/shared/api-sdk';

/**
 * 角色勾選的草稿：未動過時跟著伺服器資料走，動過之後才有自己的狀態，
 * 並算出是否與伺服器不同（決定「指派」按鈕能不能按）。
 */
export function useUserRoleSelection(roles: User['roles'] | undefined) {
  const initialRoleIds = useMemo(() => new Set((roles ?? []).map((role) => role.id)), [roles]);
  const [draftRoleIds, setDraftRoleIds] = useState<Set<string>>();
  const selectedRoleIds = draftRoleIds ?? initialRoleIds;

  const toggleRole = (roleId: string, checked: boolean) =>
    setDraftRoleIds((previous) => {
      const next = new Set(previous ?? initialRoleIds);
      if (checked) next.add(roleId);
      else next.delete(roleId);
      return next;
    });

  const isDirty =
    selectedRoleIds.size !== initialRoleIds.size ||
    [...selectedRoleIds].some((id) => !initialRoleIds.has(id));

  return { selectedRoleIds, toggleRole, isDirty };
}
