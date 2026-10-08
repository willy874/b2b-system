import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalRequest } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  approvalReviewedChanges,
  useApproveApprovalMutation,
  useDecideApprovalStepMutation,
  useOverrideApprovalStepMutation,
  useRefreshApprovalStepMutation,
  useRejectApprovalMutation,
  useWithdrawApprovalMutation,
} from '../useApprovalMutations';

const api = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  decide: vi.fn(),
  override: vi.fn(),
  refresh: vi.fn(),
  withdraw: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/approval/approve-approval/fetcher', () => ({
  fetchApproveApprovalMutation: api.approve,
}));
vi.mock('@/apis/approval/reject-approval/fetcher', () => ({
  fetchRejectApprovalMutation: api.reject,
}));
vi.mock('@/apis/approval/decide-approval-step/fetcher', () => ({
  fetchApprovalStepDecideMutation: api.decide,
}));
vi.mock('@/apis/approval/override-approval-step/fetcher', () => ({
  fetchApprovalStepOverrideMutation: api.override,
}));
vi.mock('@/apis/approval/refresh-approval-step/fetcher', () => ({
  fetchApprovalStepRefreshMutation: api.refresh,
}));
vi.mock('@/apis/approval/withdraw-approval/fetcher', () => ({
  fetchApprovalWithdrawMutation: api.withdraw,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'a1',
    type: 'role.change',
    resultResourceId: null,
    ...overrides,
  } as unknown as ApprovalRequest;
}

const APPROVAL_UPDATED = { resource: 'approval', kind: 'update', id: 'a1' };
const REGISTERED = approval({ type: 'user.register', resultResourceId: 'u1' });

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approvalReviewedChanges', () => {
  it('user.register 核准且建立了帳號 → 另宣告 user create（帶指派的角色）', () => {
    expect(approvalReviewedChanges(REGISTERED, ['r1'])).toEqual([
      APPROVAL_UPDATED,
      { resource: 'user', kind: 'create', id: 'u1', refs: { role: ['r1'] } },
    ]);
  });

  it('user.register 但還沒建立帳號（resultResourceId 為 null）→ 只宣告 approval update', () => {
    expect(approvalReviewedChanges(approval({ type: 'user.register' }), [])).toEqual([
      APPROVAL_UPDATED,
    ]);
  });

  it('其他類型 → 只宣告 approval update', () => {
    expect(approvalReviewedChanges(approval({ resultResourceId: 'x' }), ['r1'])).toEqual([
      APPROVAL_UPDATED,
    ]);
  });
});

describe('useApproveApprovalMutation', () => {
  it('核准 → 以送出的 roleIds 宣告來源變更並提示', async () => {
    api.approve.mockResolvedValue(REGISTERED);
    const result = render(() => useApproveApprovalMutation());
    act(() => result.current.mutate({ params: { id: 'a1', body: { roleIds: ['r1'] } } as never }));
    expect(await screen.findByText('已核准。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      APPROVAL_UPDATED,
      { resource: 'user', kind: 'create', id: 'u1', refs: { role: ['r1'] } },
    ]);
  });

  it('沒有指派角色 → refs.role 是空陣列', async () => {
    api.approve.mockResolvedValue(REGISTERED);
    const result = render(() => useApproveApprovalMutation());
    act(() => result.current.mutate({ params: { id: 'a1', body: {} } as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        APPROVAL_UPDATED,
        { resource: 'user', kind: 'create', id: 'u1', refs: { role: [] } },
      ]),
    );
  });

  it('失敗 → 不失效也不彈 toast，錯誤交給審核對話框', async () => {
    api.approve.mockRejectedValue(new Error('boom'));
    const result = render(() => useApproveApprovalMutation());
    act(() => result.current.mutate({ params: { id: 'a1', body: {} } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText('發生未預期的錯誤，請稍後再試。')).not.toBeInTheDocument();
  });
});

describe('useDecideApprovalStepMutation', () => {
  it.each([
    { decision: 'approve', message: '已核准。' },
    { decision: 'reject', message: '已駁回。' },
  ])('在目前關卡 $decision → 提示「$message」', async ({ decision, message }) => {
    api.decide.mockResolvedValue(approval());
    const result = render(() => useDecideApprovalStepMutation());
    act(() => result.current.mutate({ params: { id: 'a1', body: { decision } } as never }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([APPROVAL_UPDATED]);
  });

  it('最後一關核准了註冊 → 一併宣告 user create', async () => {
    api.decide.mockResolvedValue(REGISTERED);
    const result = render(() => useDecideApprovalStepMutation());
    act(() =>
      result.current.mutate({ params: { id: 'a1', body: { decision: 'approve' } } as never }),
    );
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        APPROVAL_UPDATED,
        { resource: 'user', kind: 'create', id: 'u1', refs: { role: [] } },
      ]),
    );
  });
});

describe.each([
  {
    name: 'useRejectApprovalMutation',
    hook: useRejectApprovalMutation,
    fn: api.reject,
    message: '已駁回。',
  },
  {
    name: 'useOverrideApprovalStepMutation',
    hook: useOverrideApprovalStepMutation,
    fn: api.override,
    message: '已強制定案。',
  },
  {
    name: 'useRefreshApprovalStepMutation',
    hook: useRefreshApprovalStepMutation,
    fn: api.refresh,
    message: '已依規則重新展開審核者。',
  },
  {
    name: 'useWithdrawApprovalMutation',
    hook: useWithdrawApprovalMutation,
    fn: api.withdraw,
    message: '已撤回申請。',
  },
])('$name', ({ hook, fn, message }) => {
  it('成功 → 宣告 approval update 並提示', async () => {
    fn.mockResolvedValue(approval());
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { id: 'a1', body: {} } as never }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([APPROVAL_UPDATED]);
  });
});
