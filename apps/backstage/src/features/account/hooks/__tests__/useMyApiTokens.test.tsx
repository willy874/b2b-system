import { AppError } from '@b2b-system/web-core/errors';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { useMyApiTokens } from '../useMyApiTokens';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/api-token/get-my-api-tokens/fetcher', () => ({ fetchMyApiTokensQuery: api.list }));
vi.mock('@/apis/api-token/create-my-api-token/fetcher', () => ({
  fetchMyApiTokenCreateMutation: api.create,
}));
vi.mock('@/apis/api-token/revoke-my-api-token/fetcher', () => ({
  fetchMyApiTokenRevokeMutation: api.revoke,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render() {
  return renderHook(() => useMyApiTokens(), { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ items: [] });
  usePermissionStore.setState({
    permissions: new Set(['user:read', 'audit:read', 'role:read'] as PermissionKey[]),
    hydrated: true,
  });
});

describe('useMyApiTokens（個人 token，docs/architecture/06-external-api.md §9.2 D2）', () => {
  it('可限縮的權限 = 自己持有的權限鍵，依字母排序', () => {
    const result = render();
    expect(result.current.scopeOptions).toEqual([
      { key: 'audit:read', label: 'audit:read' },
      { key: 'role:read', label: 'role:read' },
      { key: 'user:read', label: 'user:read' },
    ]);
  });

  it('列表讀取自己的 token', async () => {
    api.list.mockResolvedValue({ items: [{ id: 't1' }] });
    const result = render();
    await waitFor(() => expect(result.current.tokens.data).toEqual({ items: [{ id: 't1' }] }));
  });

  it('建立 → 宣告 apiToken create，不彈 toast', async () => {
    api.create.mockResolvedValue({ apiToken: { id: 't1' }, token: 'secret' });
    const result = render();
    act(() => result.current.create.mutate({ params: {} as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'apiToken', kind: 'create', id: 't1' },
      ]),
    );
  });

  it('建立失敗 → 不彈 toast（錯誤由建立對話框顯示）', async () => {
    api.create.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render();
    act(() => result.current.create.mutate({ params: {} as never }));
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    expect(screen.queryByText('你沒有執行這個操作的權限。')).not.toBeInTheDocument();
  });

  it('撤銷 → 宣告 apiToken update 並提示', async () => {
    api.revoke.mockResolvedValue(undefined);
    const result = render();
    act(() => result.current.revoke.mutate({ params: { tokenId: 't1' } }));
    expect(await screen.findByText('已撤銷 API token')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'apiToken', kind: 'update', id: 't1' },
    ]);
  });

  it('撤銷失敗 → 以 toast 顯示錯誤', async () => {
    api.revoke.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render();
    act(() => result.current.revoke.mutate({ params: { tokenId: 't1' } }));
    expect(await screen.findByText('你沒有執行這個操作的權限。')).toBeInTheDocument();
  });
});
