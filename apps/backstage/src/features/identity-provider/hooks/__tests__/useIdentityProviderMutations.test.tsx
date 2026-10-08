import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useCreateIdentityProviderMutation,
  useDeleteIdentityProviderMutation,
  useUpdateIdentityProviderMutation,
} from '../useIdentityProviderMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/identity-provider/create-identity-provider/fetcher', () => ({
  fetchCreateIdentityProviderMutation: api.create,
}));
vi.mock('@/apis/identity-provider/update-identity-provider/fetcher', () => ({
  fetchUpdateIdentityProviderMutation: api.update,
}));
vi.mock('@/apis/identity-provider/delete-identity-provider/fetcher', () => ({
  fetchDeleteIdentityProviderMutation: api.remove,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateIdentityProviderMutation', () => {
  it('新增成功 → 宣告 identityProvider create 並提示', async () => {
    api.create.mockResolvedValue({ id: 'p1' });
    const result = render(() => useCreateIdentityProviderMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已新增連線')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'identityProvider', kind: 'create', id: 'p1' },
    ]);
  });

  it('失敗 → 不失效也不彈 toast，錯誤交給對話框', async () => {
    api.create.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useCreateIdentityProviderMutation());
    act(() => result.current.mutate({ params: {} as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText('你沒有執行這個操作的權限。')).not.toBeInTheDocument();
  });
});

describe('useUpdateIdentityProviderMutation', () => {
  it('更新成功 → 宣告 identityProvider update 並提示', async () => {
    api.update.mockResolvedValue({ id: 'p1' });
    const result = render(() => useUpdateIdentityProviderMutation());
    act(() => result.current.mutate({ params: { id: 'p1' } as never }));
    expect(await screen.findByText('已更新連線')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'identityProvider', kind: 'update', id: 'p1' },
    ]);
  });
});

describe('useDeleteIdentityProviderMutation', () => {
  it('刪除成功 → 以參數的 id 宣告 identityProvider delete 並提示', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useDeleteIdentityProviderMutation());
    act(() => result.current.mutate({ params: { id: 'p1' } }));
    expect(await screen.findByText('已刪除連線')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'identityProvider', kind: 'delete', id: 'p1' },
    ]);
  });
});
