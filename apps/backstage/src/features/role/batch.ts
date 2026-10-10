import { registerBatchOperation } from '@b2b-system/web-core/batch';

import { ROLE_LOCALE_SCOPE } from './locale';

/** 角色列表的批次操作 id（`BatchAction.operation`）。 */
export const RoleBatchOperation = {
  DELETE: 'role.delete',
} as const;

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

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
    run: async (roleId, context) => (await runs()).deleteRoleRun(roleId, context),
  });
}
