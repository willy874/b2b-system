import { useMemo, useState } from 'react';

interface RoleDraft {
  /** 開始編輯時伺服器上的角色：送出的差異對它計算。 */
  base: readonly string[];
  selected: string[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const rightIds = new Set(right);
  return left.length === right.length && left.every((id) => rightIds.has(id));
}

/**
 * 群組持有的角色的選擇草稿。`current` 是伺服器上目前的角色；沒有改動時草稿就是它（推播讓資料重抓時跟著更新）。
 *
 * 第一次改動時記下當時的角色（`base`），差異（`add`／`remove`）對它計算：之後推播讓 `current` 變了，
 * 送出的仍只有自己這次的增減，不會把別人剛拿掉的角色加回來、或拿掉別人剛加上的（docs/architecture/iam/07-groups.md §3、§5）。
 * 這時 `isStale` 為 true，頁面提示「資料已被他人修改」，讓使用者決定要不要改用最新的角色。
 */
export function useGroupRoleDraft(current: readonly string[]) {
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  // 呼叫端每次 render 給新的陣列：以內容當依賴
  const currentKey = current.join(',');
  const now = useMemo(() => splitKey(currentKey), [currentKey]);
  const selected = draft?.selected ?? now;

  const diff = useMemo(() => {
    const base = draft?.base ?? now;
    const baseSet = new Set(base);
    const selectedSet = new Set(selected);
    return {
      add: selected.filter((id) => !baseSet.has(id)),
      remove: base.filter((id) => !selectedSet.has(id)),
    };
  }, [draft, now, selected]);

  return {
    selected,
    select: (roleIds: string[]) =>
      setDraft((previous) => ({ base: previous?.base ?? now, selected: roleIds })),
    diff,
    isDirty: diff.add.length > 0 || diff.remove.length > 0,
    /** 草稿所依據的角色已經不是伺服器上最新的：別人在這段時間改過這個群組的角色。 */
    isStale: draft !== null && !sameIds(draft.base, now),
    /** 丟掉草稿、改用伺服器上最新的角色（儲存成功後也要呼叫）。 */
    discard: () => setDraft(null),
  };
}

function splitKey(key: string): string[] {
  return key ? key.split(',') : [];
}
