import { useMemo, useState } from 'react';

/**
 * 群組持有的角色的勾選草稿。`current` 是伺服器上目前的角色；沒有改動時草稿就是它（推播讓資料重抓時跟著更新），
 * 改動之後保留使用者的勾選。儲存時送差異（`add`／`remove`），兩人同時編輯不會互相覆寫。
 */
export function useGroupRoleDraft(current: readonly string[]) {
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  // 呼叫端每次 render 給新的陣列：以內容當依賴
  const currentKey = current.join(',');
  const selected = useMemo<ReadonlySet<string>>(
    () => draft ?? new Set(splitKey(currentKey)),
    [draft, currentKey],
  );

  const diff = useMemo(() => {
    const now = splitKey(currentKey);
    const nowSet = new Set(now);
    return {
      add: [...selected].filter((id) => !nowSet.has(id)),
      remove: now.filter((id) => !selected.has(id)),
    };
  }, [currentKey, selected]);

  return {
    selected,
    toggle: (roleId: string, checked: boolean) => {
      const next = new Set(selected);
      if (checked) next.add(roleId);
      else next.delete(roleId);
      setDraft(next);
    },
    diff,
    isDirty: diff.add.length > 0 || diff.remove.length > 0,
    discard: () => setDraft(null),
  };
}

function splitKey(key: string): string[] {
  return key ? key.split(',') : [];
}
