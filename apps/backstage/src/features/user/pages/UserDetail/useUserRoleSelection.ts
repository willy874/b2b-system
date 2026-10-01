import { useMemo, useState } from 'react';

import type { User } from '@/shared/api-sdk';

interface RoleDraft {
  /** 開始編輯時伺服器上的角色：送出時帶給後端比對（`expectedRoleIds`）。 */
  base: string[];
  selected: string[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const rightIds = new Set(right);
  return left.length === right.length && left.every((id) => rightIds.has(id));
}

/**
 * 角色選擇的草稿：未動過時跟著伺服器資料走，動過之後才有自己的狀態，
 * 並算出是否與伺服器不同（決定「儲存」按鈕能不能按）。
 *
 * 草稿記下開始編輯時的角色：之後伺服器的角色被別人改了（推播更新了 `roles`），`isStale` 為 true，
 * 頁面提示「資料已被他人修改」；送出時帶上 `expectedRoleIds`，後端不符就回 409，不會蓋掉別人的變更
 */
export function useUserRoleSelection(roles: User['roles'] | undefined) {
  const serverRoleIds = useMemo(() => (roles ?? []).map((role) => role.id), [roles]);
  const [draft, setDraft] = useState<RoleDraft>();
  const selectedRoleIds = draft?.selected ?? serverRoleIds;

  const setRoleIds = (roleIds: string[]) =>
    setDraft((previous) => ({ base: previous?.base ?? serverRoleIds, selected: roleIds }));

  const isDirty = !sameIds(selectedRoleIds, serverRoleIds);
  const isStale = draft !== undefined && !sameIds(draft.base, serverRoleIds);

  return {
    selectedRoleIds,
    setRoleIds,
    isDirty,
    isStale,
    /** 送出時帶給後端：草稿所依據的角色。 */
    expectedRoleIds: draft?.base ?? serverRoleIds,
    /** 丟掉草稿、改用伺服器上最新的角色（儲存成功後也要呼叫，否則會被當成過期的草稿）。 */
    discardDraft: () => setDraft(undefined),
  };
}
