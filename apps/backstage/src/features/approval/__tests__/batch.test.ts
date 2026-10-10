import { getBatchOperation, resetBatchOperations } from '@b2b-system/web-core/batch';
import { AppError } from '@b2b-system/web-core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { approve, reject, invalidate } = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  /** 操作宣告的變更（`BatchRunContext.invalidate`；佇列合併後才交給依賴圖） */
  invalidate: vi.fn(),
}));

vi.mock('@/apis/approval/approve-approval/mutation', () => ({
  getApproveApprovalMutationOptions: () => ({ mutationFn: approve }),
}));
vi.mock('@/apis/approval/reject-approval/mutation', () => ({
  getRejectApprovalMutationOptions: () => ({ mutationFn: reject }),
}));

const { registerApprovalBatchOperations, ApprovalBatchOperation } = await import('../batch');
const { APPROVAL_LOCALE_SCOPE } = await import('../locale');

beforeEach(() => {
  vi.clearAllMocks();
  resetBatchOperations();
  registerApprovalBatchOperations();
});

function run(operation: string, id: string) {
  const definition = getBatchOperation(operation);
  if (!definition) throw new Error(`${operation} 未註冊`);
  return definition.run(id, {
    signal: new AbortController().signal,
    reportProgress: () => {},
    invalidate,
  });
}

describe('審批的批次操作（語意同列上的快速核准／駁回）', () => {
  it('註冊核准與駁回，各自帶標題、成功訊息與語系包', () => {
    expect(getBatchOperation(ApprovalBatchOperation.APPROVE)).toMatchObject({
      labelKey: 'approval.batch.approve.title',
      successKey: 'approval.batch.approve.success',
      localeScope: APPROVAL_LOCALE_SCOPE,
    });
    expect(getBatchOperation(ApprovalBatchOperation.REJECT)).toMatchObject({
      labelKey: 'approval.batch.reject.title',
      successKey: 'approval.batch.reject.success',
      localeScope: APPROVAL_LOCALE_SCOPE,
    });
  });

  it('核准：不指派角色、不附意見，失效該筆審批', async () => {
    approve.mockResolvedValue({ id: 'a1', type: 'role.grant', resultResourceId: null });
    await run(ApprovalBatchOperation.APPROVE, 'a1');

    expect(approve).toHaveBeenCalledWith({ params: { approvalId: 'a1', body: { roleIds: [] } } });
    expect(invalidate).toHaveBeenCalledWith([{ resource: 'approval', kind: 'update', id: 'a1' }]);
  });

  it('核准註冊申請 → 另宣告建立的使用者（沒有指派角色）', async () => {
    approve.mockResolvedValue({ id: 'a2', type: 'user.register', resultResourceId: 'u9' });
    await run(ApprovalBatchOperation.APPROVE, 'a2');

    expect(invalidate).toHaveBeenCalledWith([
      { resource: 'approval', kind: 'update', id: 'a2' },
      { resource: 'user', kind: 'create', id: 'u9', refs: { role: [] } },
    ]);
  });

  it('駁回：不附意見，失效該筆審批', async () => {
    reject.mockResolvedValue({ id: 'a3', type: 'user.register' });
    await run(ApprovalBatchOperation.REJECT, 'a3');

    expect(reject).toHaveBeenCalledWith({ params: { approvalId: 'a3', body: {} } });
    expect(invalidate).toHaveBeenCalledWith([{ resource: 'approval', kind: 'update', id: 'a3' }]);
  });

  it('單筆失敗 → 錯誤往上拋給佇列（列在結果對話框），不宣告變更', async () => {
    approve.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    await expect(run(ApprovalBatchOperation.APPROVE, 'a1')).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
    });
    reject.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    await expect(run(ApprovalBatchOperation.REJECT, 'a1')).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
