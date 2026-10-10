import type { BatchRunContext } from '@b2b-system/web-core/batch';

import { Resource } from '@/apis/resources';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';

import { roleRefs } from './hooks/useUserMutations';

/**
 * 使用者批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入（docs/architecture/frontend/02-plugin-system.md §4.8）。
 * 每一筆呼叫一次單筆 API、以 `invalidate` 宣告變更（同單筆 mutation hook 的 `invalidateResources`，由佇列合併套用）。
 */
const updateUser = getUserUpdateMutationOptions().mutationFn;
const unlockUser = getUserUnlockMutationOptions().mutationFn;
const deleteUser = getUserDeleteMutationOptions().mutationFn;

/**
 * 帶列表那一列的 `version`（必填）：列表資料過時（別人剛改過這個人）時這一筆以 `USER_VERSION_CONFLICT` 失敗、
 * 列在結果對話框，而不是蓋掉別人的變更（docs/architecture/backend/14-revisions.md §9.2 D4、docs/architecture/frontend/07-ui-system.md §13.6）。使用者列表一定提供版本（`getRowVersion`）；
 * 沒有版本時不自己去讀最新的：那等於後寫者勝，正是樂觀鎖要防的情況。
 */
export async function updateStatusRun(
  userId: string,
  status: 'active' | 'inactive',
  { version, invalidate }: BatchRunContext,
): Promise<void> {
  if (version === undefined) throw new Error('批次啟用／停用使用者需要列表那一列的 version');
  const user = await updateUser({ params: { userId, body: { status, version } } });
  invalidate([{ resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) }]);
}

export async function unlockRun(userId: string, { invalidate }: BatchRunContext): Promise<void> {
  const user = await unlockUser({ params: { userId } });
  invalidate([{ resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) }]);
}

export async function deleteRun(userId: string, { invalidate }: BatchRunContext): Promise<void> {
  await deleteUser({ params: { userId } });
  // 不知道被刪的人持有哪些角色 → 角色端退回整批失效（同單筆刪除）
  invalidate([{ resource: Resource.USER, kind: 'delete', id: userId }]);
}
