import { getBatchOperation, resetBatchOperations } from '@b2b-system/web-core/batch';
import { AppError } from '@b2b-system/web-core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteRole, invalidate } = vi.hoisted(() => ({
  deleteRole: vi.fn(),
  /** 操作宣告的變更（`BatchRunContext.invalidate`；佇列合併後才交給依賴圖） */
  invalidate: vi.fn(),
}));

vi.mock('@/apis/role/delete-role/mutation', () => ({
  getRoleDeleteMutationOptions: () => ({ mutationFn: deleteRole }),
}));

const { registerRoleBatchOperations, RoleBatchOperation } = await import('../batch');
const { ROLE_LOCALE_SCOPE } = await import('../locale');

beforeEach(() => {
  vi.clearAllMocks();
  resetBatchOperations();
  registerRoleBatchOperations();
});

function run(id: string) {
  const definition = getBatchOperation(RoleBatchOperation.DELETE);
  if (!definition) throw new Error(`${RoleBatchOperation.DELETE} 未註冊`);
  return definition.run(id, {
    signal: new AbortController().signal,
    reportProgress: () => {},
    invalidate,
  });
}

describe('角色的批次操作', () => {
  it('註冊批次刪除，帶標題、成功訊息與語系包', () => {
    expect(getBatchOperation(RoleBatchOperation.DELETE)).toMatchObject({
      labelKey: 'role.batch.delete.title',
      successKey: 'role.batch.delete.success',
      localeScope: ROLE_LOCALE_SCOPE,
    });
  });

  it('刪除：呼叫單筆 API（不帶 force），並失效該角色', async () => {
    deleteRole.mockResolvedValue(undefined);
    await run('r1');

    expect(deleteRole).toHaveBeenCalledWith({ params: { roleId: 'r1' } });
    expect(invalidate).toHaveBeenCalledWith([{ resource: 'role', kind: 'delete', id: 'r1' }]);
  });

  it('仍有人持有（ROLE_IN_USE）→ 錯誤往上拋給佇列列在結果對話框，不宣告變更', async () => {
    deleteRole.mockRejectedValue(new AppError('ROLE_IN_USE', 409));
    await expect(run('r1')).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
