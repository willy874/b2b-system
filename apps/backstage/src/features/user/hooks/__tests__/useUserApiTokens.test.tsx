import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useUserApiTokens } from '../useUserApiTokens';

const api = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn(), invalidateResources: vi.fn() }));
vi.mock('@/apis/api-token/get-user-api-tokens/fetcher', () => ({
  fetchUserApiTokensQuery: api.list,
}));
vi.mock('@/apis/api-token/revoke-user-api-token/fetcher', () => ({
  fetchUserApiTokenRevokeMutation: api.revoke,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render() {
  return renderHook(() => useUserApiTokens('u1'), { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ items: [{ id: 't1' }] });
});

describe('useUserApiTokens（管理者檢視與撤銷，docs/architecture/06-external-api.md §9.2 D14）', () => {
  it('讀取這位使用者的 token', async () => {
    const result = render();
    await waitFor(() => expect(result.current.tokens.data).toEqual({ items: [{ id: 't1' }] }));
    expect(api.list.mock.calls[0]![0].params).toEqual({ userId: 'u1' });
  });

  it('撤銷 → 宣告 apiToken update 並提示', async () => {
    api.revoke.mockResolvedValue(undefined);
    const result = render();
    act(() => result.current.revoke.mutate({ params: { userId: 'u1', tokenId: 't1' } }));
    expect(await screen.findByText('已撤銷 API token')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'apiToken', kind: 'update', id: 't1' },
    ]);
  });

  it('撤銷失敗 → 以 toast 顯示錯誤、不失效', async () => {
    api.revoke.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render();
    act(() => result.current.revoke.mutate({ params: { userId: 'u1', tokenId: 't1' } }));
    expect(await screen.findByText('你沒有執行這個操作的權限。')).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});
