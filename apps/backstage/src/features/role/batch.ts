import { registerBatchOperation } from '@b2b-system/web-core/batch';

import { Resource } from '@/apis/resources';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';

import { ROLE_LOCALE_SCOPE } from './locale';

/** 角色列表的批次操作 id（`BatchAction.operation`）。 */
export const RoleBatchOperation = {
  DELETE: 'role.delete',
} as const;

const deleteRole = getRoleDeleteMutationOptions().mutationFn;

/**
 * 在 plugin 的同步階段呼叫。批次刪除不帶 `force`：仍有人持有的角色由後端擋下（`ROLE_IN_USE`），
 * 列在結果對話框；要強制刪除請走單筆。
 */
export function registerRoleBatchOperations(): void {
  registerBatchOperation({
    id: RoleBatchOperation.DELETE,
    labelKey: 'role.batch.delete.title',
    localeScope: ROLE_LOCALE_SCOPE,
    successKey: 'role.batch.delete.success',
    run: async (roleId, { invalidate }) => {
      await deleteRole({ params: { roleId } });
      // 合併後失效（docs/architecture/frontend/07-ui-system.md §13.4）
      invalidate([{ resource: Resource.ROLE, kind: 'delete', id: roleId }]);
    },
  });
}
