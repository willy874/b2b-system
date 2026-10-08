import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useServiceAccountCreateMutation,
  useServiceAccountDeleteMutation,
  useServiceAccountRolesReplaceMutation,
  useServiceAccountTokenCreateMutation,
  useServiceAccountTokenRevokeMutation,
  useServiceAccountUpdateMutation,
} from '../useServiceAccountMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  roles: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/service-account/create-service-account/fetcher', () => ({
  fetchServiceAccountCreateMutation: api.create,
}));
vi.mock('@/apis/service-account/update-service-account/fetcher', () => ({
  fetchServiceAccountUpdateMutation: api.update,
}));
vi.mock('@/apis/service-account/delete-service-account/fetcher', () => ({
  fetchServiceAccountDeleteMutation: api.remove,
}));
vi.mock('@/apis/service-account/replace-service-account-roles/fetcher', () => ({
  fetchServiceAccountRolesReplaceMutation: api.roles,
}));
vi.mock('@/apis/service-account/create-service-account-token/fetcher', () => ({
  fetchServiceAccountTokenCreateMutation: api.createToken,
}));
vi.mock('@/apis/service-account/revoke-service-account-token/fetcher', () => ({
  fetchServiceAccountTokenRevokeMutation: api.revokeToken,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const ACCOUNT_UPDATED = { resource: 'serviceAccount', kind: 'update', id: 's1' };
const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useServiceAccountCreateMutation', () => {
  it('建立成功 → 宣告 serviceAccount create 與每個角色的 update（持有者人數），並提示名稱', async () => {
    api.create.mockResolvedValue({ id: 's1', name: 'CI', roles: [{ id: 'r1' }, { id: 'r2' }] });
    const result = render(() => useServiceAccountCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已建立服務帳號「CI」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'serviceAccount', kind: 'create', id: 's1' },
      { resource: 'role', kind: 'update', id: 'r1' },
      { resource: 'role', kind: 'update', id: 'r2' },
    ]);
  });
});

describe('useServiceAccountUpdateMutation', () => {
  it('更新成功 → 宣告 serviceAccount update 並提示', async () => {
    api.update.mockResolvedValue({ id: 's1' });
    const result = render(() => useServiceAccountUpdateMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } as never }));
    expect(await screen.findByText('已更新服務帳號')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([ACCOUNT_UPDATED]);
  });

  it('版本衝突 → 失效該帳號，不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('SERVICE_ACCOUNT_VERSION_CONFLICT', 409));
    const result = render(() => useServiceAccountUpdateMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith([ACCOUNT_UPDATED]));
    expect(
      screen.queryByText('這個服務帳號已經被其他人修改，請重新載入後再編輯。'),
    ).not.toBeInTheDocument();
  });

  it('其他錯誤 → 以 toast 顯示、不失效', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useServiceAccountUpdateMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useServiceAccountDeleteMutation', () => {
  it('刪除成功 → 宣告 serviceAccount delete，提示沒有「復原」', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useServiceAccountDeleteMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } }));
    expect(await screen.findByText('已刪除服務帳號')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'serviceAccount', kind: 'delete', id: 's1' },
    ]);
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(FORBIDDEN);
    const result = render(() => useServiceAccountDeleteMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useServiceAccountRolesReplaceMutation', () => {
  const params = {
    serviceAccountId: 's1',
    body: { roleIds: ['r1', 'r2'], expectedRoleIds: ['r2', 'r3'] },
  };

  it('成功 → 失效帳號與新舊角色（去重），並提示', async () => {
    api.roles.mockResolvedValue(undefined);
    const result = render(() => useServiceAccountRolesReplaceMutation());
    act(() => result.current.mutate({ params }));
    expect(await screen.findByText('已更新持有的角色')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      ACCOUNT_UPDATED,
      { resource: 'role', kind: 'update', id: 'r1' },
      { resource: 'role', kind: 'update', id: 'r2' },
      { resource: 'role', kind: 'update', id: 'r3' },
    ]);
  });

  it('別人剛改過（SERVICE_ACCOUNT_ROLES_CONFLICT）→ 重抓帳號並顯示錯誤', async () => {
    api.roles.mockRejectedValue(new AppError('SERVICE_ACCOUNT_ROLES_CONFLICT', 409));
    const result = render(() => useServiceAccountRolesReplaceMutation());
    act(() => result.current.mutate({ params }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([ACCOUNT_UPDATED]);
    expect(
      await screen.findByText('這個服務帳號的角色已經被其他人修改，請重新載入後再調整。'),
    ).toBeInTheDocument();
  });
});

describe('useServiceAccountTokenCreateMutation', () => {
  it('建立 token → 宣告 apiToken create（refs 指向服務帳號），不彈 toast', async () => {
    api.createToken.mockResolvedValue({ apiToken: { id: 't1' }, token: 'secret' });
    const result = render(() => useServiceAccountTokenCreateMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1' } as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'apiToken', kind: 'create', id: 't1', refs: { serviceAccount: ['s1'] } },
      ]),
    );
  });
});

describe('useServiceAccountTokenRevokeMutation', () => {
  it('撤銷成功 → 宣告 apiToken update（refs 指向服務帳號）並提示', async () => {
    api.revokeToken.mockResolvedValue(undefined);
    const result = render(() => useServiceAccountTokenRevokeMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1', tokenId: 't1' } }));
    expect(await screen.findByText('已撤銷 API token')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'apiToken', kind: 'update', id: 't1', refs: { serviceAccount: ['s1'] } },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.revokeToken.mockRejectedValue(FORBIDDEN);
    const result = render(() => useServiceAccountTokenRevokeMutation());
    act(() => result.current.mutate({ params: { serviceAccountId: 's1', tokenId: 't1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
