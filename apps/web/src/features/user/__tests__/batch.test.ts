import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBatchOperation, resetBatchOperations } from '@/core/batch';

const { updateUser, unlockUser, deleteUser, invalidateResources } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  unlockUser: vi.fn(),
  deleteUser: vi.fn(),
  invalidateResources: vi.fn(),
}));

vi.mock('@/apis/user/update-user/mutation', () => ({
  getUserUpdateMutationOptions: () => ({ mutationFn: updateUser }),
}));
vi.mock('@/apis/user/unlock-user/mutation', () => ({
  getUserUnlockMutationOptions: () => ({ mutationFn: unlockUser }),
}));
vi.mock('@/apis/user/delete-user/mutation', () => ({
  getUserDeleteMutationOptions: () => ({ mutationFn: deleteUser }),
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources,
}));

const { registerUserBatchOperations, UserBatchOperation } = await import('../batch');

const user = { id: 'u1', roles: [{ id: 'r1' }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetBatchOperations();
  registerUserBatchOperations();
});

function run(operation: string, id: string) {
  const definition = getBatchOperation(operation);
  if (!definition) throw new Error(`${operation} 未註冊`);
  return definition.run(id);
}

describe('使用者的批次操作（每筆呼叫一次單筆 API）', () => {
  it('啟用／停用：PATCH 單筆的 status，並失效該使用者與其角色', async () => {
    updateUser.mockResolvedValue(user);
    await run(UserBatchOperation.DEACTIVATE, 'u1');

    expect(updateUser).toHaveBeenCalledWith({
      params: { userId: 'u1', body: { status: 'inactive' } },
    });
    expect(invalidateResources).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'update', id: 'u1', refs: { role: ['r1'] } }),
    ]);
  });

  it('解鎖：呼叫單筆解鎖', async () => {
    unlockUser.mockResolvedValue(user);
    await run(UserBatchOperation.UNLOCK, 'u1');
    expect(unlockUser).toHaveBeenCalledWith({ params: { userId: 'u1' } });
  });

  it('刪除：呼叫單筆刪除並失效', async () => {
    deleteUser.mockResolvedValue(undefined);
    await run(UserBatchOperation.DELETE, 'u1');
    expect(deleteUser).toHaveBeenCalledWith({ params: { userId: 'u1' } });
    expect(invalidateResources).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'delete', id: 'u1' }),
    ]);
  });

  it('單筆 API 失敗時直接拋出，交給佇列記錄為失敗、不失效快取', async () => {
    updateUser.mockRejectedValue(new Error('boom'));
    await expect(run(UserBatchOperation.ACTIVATE, 'u1')).rejects.toThrow('boom');
    expect(invalidateResources).not.toHaveBeenCalled();
  });
});
