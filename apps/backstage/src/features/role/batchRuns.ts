import type { BatchRunContext } from '@b2b-system/web-core/batch';

import { Resource } from '@/apis/resources';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';

/**
 * 角色批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入，API 與 mutation 的程式不進首頁的初始載入
 * （docs/architecture/frontend/02-plugin-system.md §4.8）。
 */
const deleteRole = getRoleDeleteMutationOptions().mutationFn;

export async function deleteRoleRun(
  roleId: string,
  { invalidate }: BatchRunContext,
): Promise<void> {
  await deleteRole({ params: { roleId } });
  // 合併後失效（docs/architecture/frontend/07-ui-system.md §13.4）
  invalidate([{ resource: Resource.ROLE, kind: 'delete', id: roleId }]);
}
