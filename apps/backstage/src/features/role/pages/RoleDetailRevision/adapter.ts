import { formatDateTime } from '@b2b-system/web-shared/date';

import type { RevisionSummary, RoleRevisionSnapshot } from '@/shared/api-sdk';

export interface RoleRevisionRowVM {
  version: number;
  /** 寫入的人；系統（基準版本）或已被永久刪除的人是 null，畫面顯示「系統」。 */
  actorName: string | null;
  createdAt: string;
  /** 快照過大未保存：看不到內容、不能還原。 */
  tooLarge: boolean;
}

export function toRoleRevisionRowVM(item: RevisionSummary): RoleRevisionRowVM {
  return {
    version: item.version,
    actorName: item.actor?.name ?? null,
    createdAt: formatDateTime(item.createdAt),
    tooLarge: item.tooLarge,
  };
}

/**
 * 兩版的權限鍵是否不同：還原會改變權限鍵時，後端另外要求 `role:grantPermission`
 * （docs/architecture/backend/14-revisions.md §4.3），畫面先據此提示。任一邊沒有內容時視為相同（交給後端判斷）。
 */
export function permissionKeysDiffer(
  a: RoleRevisionSnapshot | null | undefined,
  b: RoleRevisionSnapshot | null | undefined,
): boolean {
  if (!a || !b) return false;
  const left = new Set(a.permissionKeys);
  return (
    a.permissionKeys.length !== b.permissionKeys.length ||
    b.permissionKeys.some((key) => !left.has(key))
  );
}
