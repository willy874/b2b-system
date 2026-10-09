import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useApprovalReview } from '../useApprovalReview';

type FakeMutation = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  variables?: unknown;
};

const mutations = vi.hoisted(() => {
  return {
    approve: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
    reject: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
    decide: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
    override: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
    refresh: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
    withdraw: { mutateAsync: vi.fn(), isPending: false } as FakeMutation,
  };
});
vi.mock('../../../hooks/useApprovalMutations', () => ({
  useApproveApprovalMutation: () => mutations.approve,
  useRejectApprovalMutation: () => mutations.reject,
  useDecideApprovalStepMutation: () => mutations.decide,
  useOverrideApprovalStepMutation: () => mutations.override,
  useRefreshApprovalStepMutation: () => mutations.refresh,
  useWithdrawApprovalMutation: () => mutations.withdraw,
}));

function setup() {
  const onReviewed = vi.fn();
  const hook = renderHook(() => useApprovalReview('a1', onReviewed), { wrapper: AllProviders });
  return { ...hook, onReviewed };
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  for (const mutation of Object.values(mutations)) {
    mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mutation.isPending = false;
    mutation.variables = undefined;
  }
});

describe('useApprovalReview（審核表單的狀態）', () => {
  it('輸入意見或選了角色才算有變更；只有空白不算', () => {
    const { result } = setup();
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setComment('   '));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setRoleIds(['r1']));
    expect(result.current.isDirty).toBe(true);
  });

  it('核准：送出去頭尾空白的意見與角色，成功後呼叫 onReviewed', async () => {
    const { result, onReviewed } = setup();
    act(() => {
      result.current.setComment('  沒問題 ');
      result.current.setRoleIds(['r1']);
    });
    await act(() => result.current.approve());
    expect(mutations.approve.mutateAsync).toHaveBeenCalledWith({
      params: { approvalId: 'a1', body: { comment: '沒問題', roleIds: ['r1'] } },
    });
    expect(onReviewed).toHaveBeenCalledWith('decided');
    // 留在原頁時不再算「未儲存」
    expect(result.current).toMatchObject({ comment: '', roleIds: [], isDirty: false });
  });

  it('駁回失敗 → 顯示錯誤訊息、不呼叫 onReviewed；再次送出時先清掉錯誤', async () => {
    mutations.reject.mutateAsync.mockRejectedValueOnce(new AppError('USER_EMAIL_DUPLICATE', 409));
    const { result, onReviewed } = setup();
    await act(() => result.current.reject());
    expect(mutations.reject.mutateAsync).toHaveBeenCalledWith({
      params: { approvalId: 'a1', body: { comment: undefined } },
    });
    expect(result.current.error).toBeTruthy();
    expect(onReviewed).not.toHaveBeenCalled();

    await act(() => result.current.reject());
    expect(result.current.error).toBeUndefined();
    expect(onReviewed).toHaveBeenCalledTimes(1);
  });

  it('多階段：在指定的關卡同意或駁回（不帶角色）', async () => {
    const { result } = setup();
    act(() => result.current.setComment('ok'));
    await act(() => result.current.decide(2, 'reject'));
    expect(mutations.decide.mutateAsync).toHaveBeenCalledWith({
      params: {
        approvalId: 'a1',
        ordinal: 2,
        body: { decision: 'reject', comment: 'ok', roleIds: [] },
      },
    });
  });

  it('強制定案：沒有意見時送空字串（後端會擋）', async () => {
    const { result } = setup();
    await act(() => result.current.override(1, 'approve'));
    expect(mutations.override.mutateAsync).toHaveBeenCalledWith({
      params: {
        approvalId: 'a1',
        ordinal: 1,
        body: { decision: 'approve', comment: '', roleIds: [] },
      },
    });
  });

  it('重新展開審核者：成功不關閉，失敗顯示錯誤', async () => {
    const { result, onReviewed } = setup();
    await act(() => result.current.refresh(1));
    expect(mutations.refresh.mutateAsync).toHaveBeenCalledWith({
      params: { approvalId: 'a1', ordinal: 1 },
    });
    expect(onReviewed).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();

    mutations.refresh.mutateAsync.mockRejectedValueOnce(new AppError('APPROVAL_NOT_FOUND', 404));
    await act(() => result.current.refresh(1));
    expect(result.current.error).toBeTruthy();
  });

  it('撤回後以 withdrawn 呼叫 onReviewed（不前往下一筆）', async () => {
    const { result, onReviewed } = setup();
    await act(() => result.current.withdraw());
    expect(mutations.withdraw.mutateAsync).toHaveBeenCalledWith({ params: { approvalId: 'a1' } });
    expect(onReviewed).toHaveBeenCalledWith('withdrawn');
  });

  it('進行中的狀態：關卡決定依 decision 分成核准中或駁回中', () => {
    mutations.decide.isPending = true;
    mutations.decide.variables = { params: { body: { decision: 'reject' } } };
    const { result, rerender } = setup();
    expect(result.current).toMatchObject({
      isPending: true,
      isApproving: false,
      isRejecting: true,
    });

    mutations.decide.variables = { params: { body: { decision: 'approve' } } };
    rerender();
    expect(result.current).toMatchObject({ isApproving: true, isRejecting: false });

    mutations.decide.isPending = false;
    mutations.override.isPending = true;
    mutations.refresh.isPending = true;
    mutations.withdraw.isPending = true;
    rerender();
    expect(result.current).toMatchObject({
      isPending: true,
      isApproving: false,
      isOverriding: true,
      isRefreshing: true,
      isWithdrawing: true,
    });
  });
});
