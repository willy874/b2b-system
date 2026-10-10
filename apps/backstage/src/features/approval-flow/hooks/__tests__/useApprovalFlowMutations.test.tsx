import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useApprovalFlowPreviewMutation,
  useApprovalFlowResetMutation,
  useApprovalFlowSaveMutation,
} from '../useApprovalFlowMutations';

const api = vi.hoisted(() => ({
  put: vi.fn(),
  preview: vi.fn(),
  reset: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/approval-flow/put-approval-flow/fetcher', () => ({
  fetchApprovalFlowPutMutation: api.put,
}));
vi.mock('@/apis/approval-flow/preview-approval-flow/fetcher', () => ({
  fetchApprovalFlowPreviewMutation: api.preview,
}));
vi.mock('@/apis/approval-flow/reset-approval-flow/fetcher', () => ({
  fetchApprovalFlowResetMutation: api.reset,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const CONFLICT_MESSAGE = '流程已被他人修改，請重新載入後再儲存。';
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useApprovalFlowSaveMutation', () => {
  it('第一次儲存（沒有 version）→ 以 create 宣告該類型並提示', async () => {
    api.put.mockResolvedValue({ type: 'user.register', version: 1 });
    const result = render(() => useApprovalFlowSaveMutation());
    const variables = { params: { type: 'user.register', body: { stages: [] } as never } };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已儲存流程')).toBeInTheDocument();
    expect(api.put.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'approvalFlow', kind: 'create', id: 'user.register' },
    ]);
  });

  it('取代既有的流程（帶 version）→ 以 update 宣告', async () => {
    api.put.mockResolvedValue({ type: 'user.register', version: 3 });
    const result = render(() => useApprovalFlowSaveMutation());
    act(() =>
      result.current.mutate({
        params: { type: 'user.register', body: { stages: [], version: 2 } as never },
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'approvalFlow', kind: 'update', id: 'user.register' },
    ]);
  });

  it('版本衝突 → 失效該類型，訊息交給頁面（不彈 toast）', async () => {
    api.put.mockRejectedValue(new AppError('APPROVAL_FLOW_VERSION_CONFLICT', 409));
    const result = render(() => useApprovalFlowSaveMutation());
    act(() =>
      result.current.mutate({
        params: { type: 'user.register', body: { stages: [], version: 2 } as never },
      }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'approvalFlow', kind: 'update', id: 'user.register' },
    ]);
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('其他錯誤 → 不失效、不彈 toast，錯誤交給頁面標到關卡上', async () => {
    api.put.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useApprovalFlowSaveMutation());
    act(() =>
      result.current.mutate({ params: { type: 'user.register', body: { stages: [] } as never } }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useApprovalFlowPreviewMutation', () => {
  it('試算是唯讀：回傳結果，不失效任何資源', async () => {
    api.preview.mockResolvedValue({ stages: [] });
    const result = render(() => useApprovalFlowPreviewMutation());
    act(() => result.current.mutate({ params: { type: 'user.register' } } as never));

    await waitFor(() => expect(result.current.data).toEqual({ stages: [] }));
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useApprovalFlowResetMutation', () => {
  it('重設成功 → 帶 version 呼叫、以 delete 宣告該類型並提示', async () => {
    api.reset.mockResolvedValue(undefined);
    const result = render(() => useApprovalFlowResetMutation());
    act(() => result.current.mutate({ params: { type: 'user.register', version: 4 } }));

    expect(await screen.findByText('已重設流程，回到單關審批')).toBeInTheDocument();
    expect(api.reset.mock.calls[0]![0]).toEqual({
      params: { type: 'user.register', version: 4 },
    });
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'approvalFlow', kind: 'delete', id: 'user.register' },
    ]);
  });

  it('版本衝突 → 失效該類型讓畫面拿到最新版本，並以 toast 顯示', async () => {
    api.reset.mockRejectedValue(new AppError('APPROVAL_FLOW_VERSION_CONFLICT', 409));
    const result = render(() => useApprovalFlowResetMutation());
    act(() => result.current.mutate({ params: { type: 'user.register', version: 4 } }));

    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'approvalFlow', kind: 'update', id: 'user.register' },
    ]);
  });

  it('其他錯誤 → 只以 toast 顯示、不失效', async () => {
    api.reset.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useApprovalFlowResetMutation());
    act(() => result.current.mutate({ params: { type: 'user.register', version: 4 } }));

    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});
