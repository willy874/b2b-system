import { invalidateResources, Resource } from '@/apis/resources';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';
import { registerBatchOperation } from '@/core/batch';

import { roleRefs } from './hooks/useUserMutations';
import { USER_LOCALE_SCOPE } from './locale';

/** 使用者列表的批次操作 id（`BatchAction.operation`）。 */
export const UserBatchOperation = {
  ACTIVATE: 'user.activate',
  DEACTIVATE: 'user.deactivate',
  UNLOCK: 'user.unlock',
  DELETE: 'user.delete',
} as const;

const updateUser = getUserUpdateMutationOptions().mutationFn;
const unlockUser = getUserUnlockMutationOptions().mutationFn;
const deleteUser = getUserDeleteMutationOptions().mutationFn;

/**
 * 帶列表那一列的 `version`：列表資料過時（別人剛改過這個人）時這一筆以 `USER_VERSION_CONFLICT` 失敗、
 * 列在結果對話框，而不是蓋掉別人的變更（ADR-0025 D4、ADR-0009）。
 */
async function updateStatus(
  userId: string,
  status: 'active' | 'inactive',
  version: number | undefined,
): Promise<void> {
  const user = await updateUser({ params: { userId, body: { status, version } } });
  invalidateResources([
    { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
  ]);
}

/**
 * 在 plugin 的同步階段呼叫。每一筆呼叫一次單筆 API、失效快取（同單筆 mutation hook），
 * 不發 toast：結果由批次佇列在整批結束時彈出（docs/adr/0012-batch-queue-worker.md）。
 */
export function registerUserBatchOperations(): void {
  registerBatchOperation({
    id: UserBatchOperation.ACTIVATE,
    labelKey: 'user.batch.activate.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.activate.success',
    run: (userId, { version }) => updateStatus(userId, 'active', version),
  });
  registerBatchOperation({
    id: UserBatchOperation.DEACTIVATE,
    labelKey: 'user.batch.deactivate.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.deactivate.success',
    run: (userId, { version }) => updateStatus(userId, 'inactive', version),
  });
  registerBatchOperation({
    id: UserBatchOperation.UNLOCK,
    labelKey: 'user.batch.unlock.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.unlock.success',
    run: async (userId) => {
      const user = await unlockUser({ params: { userId } });
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
    },
  });
  registerBatchOperation({
    id: UserBatchOperation.DELETE,
    labelKey: 'user.batch.delete.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.delete.success',
    run: async (userId) => {
      await deleteUser({ params: { userId } });
      // 不知道被刪的人持有哪些角色 → 角色端退回整批失效（同單筆刪除）
      invalidateResources([{ resource: Resource.USER, kind: 'delete', id: userId }]);
    },
  });
}
