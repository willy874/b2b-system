import { getBatchOperation, resetBatchOperations } from '@b2b-system/web-core/batch';
import { AppError } from '@b2b-system/web-core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateUser, unlockUser, deleteUser, invalidate } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  unlockUser: vi.fn(),
  deleteUser: vi.fn(),
  /** 操作宣告的變更（`BatchRunContext.invalidate`；佇列合併後才交給依賴圖） */
  invalidate: vi.fn(),
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

const { registerUserBatchOperations, UserBatchOperation } = await import('../batch');

const user = { id: 'u1', roles: [{ id: 'r1' }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetBatchOperations();
  registerUserBatchOperations();
});

function run(operation: string, id: string, version?: number) {
  const definition = getBatchOperation(operation);
  if (!definition) throw new Error(`${operation} 未註冊`);
  return definition.run(id, {
    signal: new AbortController().signal,
    reportProgress: () => {},
    version,
    invalidate,
  });
}

describe('使用者的批次操作（每筆呼叫一次單筆 API）', () => {
  it('啟用／停用：PATCH 單筆的 status（帶列表那一列的 version），並失效該使用者與其角色', async () => {
    updateUser.mockResolvedValue(user);
    await run(UserBatchOperation.DEACTIVATE, 'u1', 4);

    expect(updateUser).toHaveBeenCalledWith({
      params: { userId: 'u1', body: { status: 'inactive', version: 4 } },
    });
    expect(invalidate).toHaveBeenCalledWith([
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
    expect(invalidate).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'delete', id: 'u1' }),
    ]);
  });

  it('列表資料過時（USER_VERSION_CONFLICT）→ 這一筆失敗、交給佇列記錄，不失效快取', async () => {
    updateUser.mockRejectedValue(new AppError('USER_VERSION_CONFLICT', 409, { current: 5 }));
    await expect(run(UserBatchOperation.ACTIVATE, 'u1', 4)).rejects.toMatchObject({
      code: 'USER_VERSION_CONFLICT',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('單筆 API 失敗時直接拋出，交給佇列記錄為失敗、不失效快取', async () => {
    updateUser.mockRejectedValue(new Error('boom'));
    await expect(run(UserBatchOperation.ACTIVATE, 'u1', 1)).rejects.toThrow('boom');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('沒有列表那一列的 version → 這一筆失敗、不送出（version 必填，不自己讀最新的而後寫者勝）', async () => {
    await expect(run(UserBatchOperation.DEACTIVATE, 'u1')).rejects.toThrow();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
