import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useCommentCreateMutation,
  useCommentDeleteMutation,
  useCommentUpdateMutation,
} from '../useCommentMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/comment/create-comment/fetcher', () => ({
  fetchCommentCreateMutation: api.create,
}));
vi.mock('@/apis/comment/update-comment/fetcher', () => ({
  fetchCommentUpdateMutation: api.update,
}));
vi.mock('@/apis/comment/delete-comment/fetcher', () => ({
  fetchCommentDeleteMutation: api.remove,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const UPDATED = [{ resource: 'comment', kind: 'update', id: 'c1' }];

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCommentCreateMutation', () => {
  it('留言成功 → 宣告 comment create', async () => {
    api.create.mockResolvedValue({ id: 'c1' });
    const result = render(() => useCommentCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'comment', kind: 'create', id: 'c1' },
      ]),
    );
  });
});

describe('useCommentUpdateMutation', () => {
  it('編輯成功 → 宣告 comment update', async () => {
    api.update.mockResolvedValue({ id: 'c1' });
    const result = render(() => useCommentUpdateMutation());
    act(() => result.current.mutate({ params: { commentId: 'c1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED));
  });

  it('版本衝突 → 失效該留言讓列表拿到最新版本', async () => {
    api.update.mockRejectedValue(new AppError('COMMENT_VERSION_CONFLICT', 409));
    const result = render(() => useCommentUpdateMutation());
    act(() => result.current.mutate({ params: { commentId: 'c1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED));
  });

  it('其他錯誤 → 不失效，交給編輯器', async () => {
    api.update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useCommentUpdateMutation());
    act(() => result.current.mutate({ params: { commentId: 'c1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useCommentDeleteMutation', () => {
  it('刪除成功 → 宣告 comment delete 並提示', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useCommentDeleteMutation());
    act(() => result.current.mutate({ params: { commentId: 'c1' } }));
    expect(await screen.findByText('已刪除留言')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'comment', kind: 'delete', id: 'c1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useCommentDeleteMutation());
    act(() => result.current.mutate({ params: { commentId: 'c1' } }));
    expect(await screen.findByText('你沒有執行這個操作的權限。')).toBeInTheDocument();
  });
});
