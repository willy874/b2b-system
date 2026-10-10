import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useTagCreateMutation,
  useTagDeleteMutation,
  useTagUpdateMutation,
} from '../useTagMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/tag/create-tag/fetcher', () => ({ fetchTagCreateMutation: api.create }));
vi.mock('@/apis/tag/update-tag/fetcher', () => ({ fetchTagUpdateMutation: api.update }));
vi.mock('@/apis/tag/delete-tag/fetcher', () => ({ fetchTagDeleteMutation: api.remove }));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const NOT_FOUND_MESSAGE = '找不到這個標籤，可能已被刪除，或不屬於這類資源。';
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTagCreateMutation', () => {
  it('建立成功 → 以 create 宣告新標籤，提示帶名稱', async () => {
    api.create.mockResolvedValue({ id: 't1', name: '重要' });
    const result = render(() => useTagCreateMutation());
    const variables = { params: { name: '重要', color: 'red' } as never };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已建立標籤「重要」')).toBeInTheDocument();
    expect(api.create.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'tag', kind: 'create', id: 't1' },
    ]);
  });

  it('錯誤（例：同名）交給表單：不失效、不彈 toast', async () => {
    api.create.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useTagCreateMutation());
    act(() => result.current.mutate({ params: { name: '重要' } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useTagUpdateMutation', () => {
  it('更新成功 → 以 update 宣告該標籤並提示', async () => {
    api.update.mockResolvedValue({ id: 't1', name: '次要' });
    const result = render(() => useTagUpdateMutation());
    const variables = { params: { tagId: 't1', body: { name: '次要', version: 2 } } as never };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已更新標籤')).toBeInTheDocument();
    expect(api.update.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'tag', kind: 'update', id: 't1' },
    ]);
  });

  it('版本衝突 → 失效該標籤讓列表拿到最新版本，訊息交給表單', async () => {
    api.update.mockRejectedValue(new AppError('TAG_VERSION_CONFLICT', 409));
    const result = render(() => useTagUpdateMutation());
    act(() => result.current.mutate({ params: { tagId: 't1', body: { version: 2 } } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'tag', kind: 'update', id: 't1' },
    ]);
  });

  it('其他錯誤 → 不失效、不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useTagUpdateMutation());
    act(() => result.current.mutate({ params: { tagId: 't1', body: { version: 2 } } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useTagDeleteMutation', () => {
  it('刪除成功 → 以 delete 宣告並提示，沒有「復原」（硬刪除）', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useTagDeleteMutation());
    act(() => result.current.mutate({ params: { tagId: 't1' } }));

    expect(await screen.findByText('已刪除標籤')).toBeInTheDocument();
    expect(api.remove.mock.calls[0]![0]).toEqual({ params: { tagId: 't1' } });
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'tag', kind: 'delete', id: 't1' },
    ]);
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤、不失效', async () => {
    api.remove.mockRejectedValue(new AppError('TAG_NOT_FOUND', 404));
    const result = render(() => useTagDeleteMutation());
    act(() => result.current.mutate({ params: { tagId: 't1' } }));

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});
