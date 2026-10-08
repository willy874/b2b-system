import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useFileAccessRequestMutation,
  useFileAccessReviewMutation,
  useFolderGrantDeleteMutation,
  useFolderGrantSetMutation,
  useFolderInheritanceMutation,
} from '../useFolderGrantMutations';

const api = vi.hoisted(() => ({
  set: vi.fn(),
  remove: vi.fn(),
  inherit: vi.fn(),
  request: vi.fn(),
  review: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/file/set-file-folder-grant/fetcher', () => ({
  fetchFileFolderGrantSetMutation: api.set,
}));
vi.mock('@/apis/file/delete-file-folder-grant/fetcher', () => ({
  fetchFileFolderGrantDeleteMutation: api.remove,
}));
vi.mock('@/apis/file/update-file-folder-access/fetcher', () => ({
  fetchFileFolderAccessUpdateMutation: api.inherit,
}));
vi.mock('@/apis/file/create-file-access-request/fetcher', () => ({
  fetchFileAccessRequestCreateMutation: api.request,
}));
vi.mock('@/apis/file/review-file-access-request/fetcher', () => ({
  fetchFileAccessRequestReviewMutation: api.review,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';
const FOLDER_UPDATED = [{ resource: 'fileFolder', kind: 'update', id: 'f1' }];

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([
  {
    name: 'useFolderGrantSetMutation',
    hook: useFolderGrantSetMutation,
    fn: api.set,
    message: '已更新授權',
  },
  {
    name: 'useFolderGrantDeleteMutation',
    hook: useFolderGrantDeleteMutation,
    fn: api.remove,
    message: '已移除授權',
  },
  {
    name: 'useFolderInheritanceMutation',
    hook: useFolderInheritanceMutation,
    fn: api.inherit,
    message: '已更新繼承設定',
  },
])('$name', ({ hook, fn, message }) => {
  it('成功 → 失效該資料夾（能力旗標與授權清單）並提示', async () => {
    fn.mockResolvedValue(undefined);
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(FOLDER_UPDATED);
  });

  it('失敗（反提權、對象已刪除）→ 以 toast 顯示錯誤、不失效', async () => {
    fn.mockRejectedValue(FORBIDDEN);
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useFileAccessRequestMutation', () => {
  it('新送出申請 → 提示已送出', async () => {
    api.request.mockResolvedValue({ submitted: true });
    const result = render(() => useFileAccessRequestMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText('已送出申請')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(FOLDER_UPDATED);
  });

  it('已有待審 → 提示已經申請過', async () => {
    api.request.mockResolvedValue({ submitted: false });
    const result = render(() => useFileAccessRequestMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText('已經申請過了，請等待審核')).toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.request.mockRejectedValue(FORBIDDEN);
    const result = render(() => useFileAccessRequestMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useFileAccessReviewMutation', () => {
  it.each([
    { decision: 'approve', message: '已核准申請' },
    { decision: 'reject', message: '已駁回申請' },
  ])('$decision → 失效資料夾與該審批，提示「$message」', async ({ decision, message }) => {
    api.review.mockResolvedValue(undefined);
    const result = render(() => useFileAccessReviewMutation());
    act(() =>
      result.current.mutate({ params: { folderId: 'f1', requestId: 'r1', decision } as never }),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenNthCalledWith(1, FOLDER_UPDATED);
    expect(api.invalidateResources).toHaveBeenNthCalledWith(2, [
      { resource: 'approval', kind: 'update', id: 'r1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.review.mockRejectedValue(FORBIDDEN);
    const result = render(() => useFileAccessReviewMutation());
    act(() =>
      result.current.mutate({
        params: { folderId: 'f1', requestId: 'r1', decision: 'approve' } as never,
      }),
    );
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
