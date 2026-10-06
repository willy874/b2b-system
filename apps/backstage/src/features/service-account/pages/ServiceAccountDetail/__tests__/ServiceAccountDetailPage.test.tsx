import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServiceAccountDetailQueryOptions } from '@/apis/service-account/get-service-account-detail/query';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerServiceAccountPagePermissions, Routes } from '../../..';
import serviceAccountZhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchAccount, fetchTokens, fetchRoles, createToken, revokeToken, replaceRoles } =
  vi.hoisted(() => ({
    fetchList: vi.fn(),
    fetchAccount: vi.fn(),
    fetchTokens: vi.fn(),
    fetchRoles: vi.fn(),
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    replaceRoles: vi.fn(),
  }));
vi.mock('@/apis/service-account/get-service-account-list/fetcher', () => ({
  fetchServiceAccountListQuery: fetchList,
}));
vi.mock('@/apis/service-account/get-service-account-detail/fetcher', () => ({
  fetchServiceAccountDetailQuery: fetchAccount,
}));
vi.mock('@/apis/service-account/get-service-account-tokens/fetcher', () => ({
  fetchServiceAccountTokensQuery: fetchTokens,
}));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/service-account/create-service-account-token/fetcher', () => ({
  fetchServiceAccountTokenCreateMutation: createToken,
}));
vi.mock('@/apis/service-account/revoke-service-account-token/fetcher', () => ({
  fetchServiceAccountTokenRevokeMutation: revokeToken,
}));
vi.mock('@/apis/service-account/replace-service-account-roles/fetcher', () => ({
  fetchServiceAccountRolesReplaceMutation: replaceRoles,
}));

const TOKEN = 'b2bt_acme_0000000000000000000001_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const apiToken = {
  id: 't1',
  name: '建置機',
  prefix: 'b2bt_acme_0000000000000000000001_abcd',
  scopes: null,
  status: 'active',
  expiresAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: { id: 'u1', displayName: '管理員' },
};
const role = (id: string, slug: string) => ({
  id,
  slug,
  name: slug,
  description: null,
  isSystem: true,
  permissionCount: 1,
  userCount: 0,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const READER = ['serviceAccount:read', 'role:read'] as PermissionKey[];

/** 打開角色下拉，點一個角色（多選：再點一次是取消）。 */
async function chooseRole(id: string) {
  fireEvent.click(
    await screen.findByTestId('service-account-role-select', undefined, { timeout: 5000 }),
  );
  await screen.findByRole('listbox');
  const option = screen
    .getAllByTestId('select-item')
    .find((item) => item.getAttribute('data-value') === id);
  if (!option) throw new Error(`找不到角色選項 ${id}`);
  fireEvent.click(option);
}
const MANAGER = ['serviceAccount:read', 'serviceAccount:update', 'role:read'] as PermissionKey[];
const routes = [Routes.ServiceAccountListRoute.addChildren([Routes.ServiceAccountDetailRoute])];

beforeAll(() => initTestI18n(serviceAccountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerServiceAccountPagePermissions();
  fetchList.mockReset().mockResolvedValue({
    items: [],
    pagination: { offset: 0, limit: 20, total: 0 },
  });
  fetchAccount.mockReset().mockResolvedValue({
    id: 'sa1',
    name: 'CI 建置',
    status: 'active',
    roles: [{ id: 'r1', slug: 'auditor', name: '稽核人員', isSystem: true }],
    activeTokenCount: 1,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
  fetchTokens.mockReset().mockResolvedValue({ items: [apiToken] });
  fetchRoles.mockReset().mockResolvedValue({ items: [], pagination: { total: 0 } });
  createToken.mockReset().mockResolvedValue({ token: TOKEN, apiToken: { ...apiToken, id: 't2' } });
  revokeToken.mockReset().mockResolvedValue(undefined);
  replaceRoles.mockReset().mockResolvedValue({ roles: [] });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('ServiceAccountDetailPage（docs/architecture/06-external-api.md §9 T4）', () => {
  it('只有 serviceAccount:read → 看得到 token 列表，不能建立、撤銷、編輯', async () => {
    renderRoute(routes, '/service-account/sa1', READER);
    await screen.findByText('建置機', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('service-account-token-create-button')).toBeNull();
    expect(screen.queryByTestId('api-token-revoke-button')).toBeNull();
    expect(screen.queryByTestId('service-account-edit-button')).toBeNull();
    // 列表只顯示開頭，不是完整的 token
    expect(screen.getByTestId('api-token-prefix')).toHaveTextContent(apiToken.prefix);
  });

  it('建立 token：完整的 token 只在建立後顯示一次，關掉就不見', async () => {
    renderRoute(routes, '/service-account/sa1', MANAGER);
    fireEvent.click(
      await screen.findByTestId('service-account-token-create-button', undefined, {
        timeout: 5000,
      }),
    );
    const dialog = await screen.findByTestId('api-token-create-dialog');
    fireEvent.change(within(dialog).getByTestId('api-token-name-input'), {
      target: { value: '部署' },
    });
    fireEvent.click(within(dialog).getByTestId('api-token-create-submit'));

    expect(await screen.findByTestId('api-token-value')).toHaveTextContent(TOKEN);
    expect(createToken.mock.calls[0]![0]).toMatchObject({
      params: { serviceAccountId: 'sa1', body: { name: '部署', expiresInDays: 30 } },
    });

    fireEvent.click(screen.getByTestId('api-token-done'));
    await waitFor(() => expect(screen.queryByText(TOKEN)).toBeNull());
  });

  it('撤銷：確認後呼叫撤銷', async () => {
    renderRoute(routes, '/service-account/sa1', MANAGER);
    fireEvent.click(
      await screen.findByTestId('api-token-revoke-button', undefined, { timeout: 5000 }),
    );
    const confirm = await screen.findByTestId('api-token-revoke-confirm');
    expect(confirm).toHaveTextContent('建置機');
    fireEvent.click(within(confirm).getByRole('button', { name: '撤銷' }));
    await waitFor(() => expect(revokeToken).toHaveBeenCalledTimes(1));
    expect(revokeToken.mock.calls[0]![0]).toMatchObject({
      params: { serviceAccountId: 'sa1', tokenId: 't1' },
    });
  });

  describe('角色（docs/architecture/backend/03-api-conventions.md §11）', () => {
    beforeEach(() => {
      fetchRoles.mockResolvedValue({
        items: [role('r1', 'auditor'), role('r2', 'member'), role('r3', 'admin')],
        pagination: { total: 3 },
      });
    });

    it('修改後資料被重抓（推播）：expectedRoleIds 仍是修改前的角色，並提示已被他人修改', async () => {
      const { queryClient } = renderRoute(routes, '/service-account/sa1', MANAGER);
      await chooseRole('r2');

      // 別人同時加了 r3：推播讓詳情重抓
      act(() =>
        queryClient.setQueryData(getServiceAccountDetailQueryOptions('sa1').queryKey, (old) =>
          old
            ? {
                ...old,
                roles: [...old.roles, { id: 'r3', slug: 'admin', name: 'admin', isSystem: true }],
              }
            : old,
        ),
      );
      expect(await screen.findByTestId('service-account-role-stale')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('service-account-save-roles-button'));
      await waitFor(() => expect(replaceRoles).toHaveBeenCalledTimes(1));
      expect(replaceRoles.mock.calls[0]![0]).toMatchObject({
        params: {
          serviceAccountId: 'sa1',
          body: { roleIds: ['r1', 'r2'], expectedRoleIds: ['r1'] },
        },
      });
    });

    it('409 衝突：選擇保留，不清掉草稿', async () => {
      replaceRoles.mockRejectedValue(new AppError('SERVICE_ACCOUNT_ROLES_CONFLICT', 409));
      renderRoute(routes, '/service-account/sa1', MANAGER);
      await chooseRole('r2');

      fireEvent.click(screen.getByTestId('service-account-save-roles-button'));
      await waitFor(() => expect(replaceRoles).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId('service-account-save-roles-button')).toBeEnabled(),
      );
      fireEvent.click(screen.getByTestId('service-account-save-roles-button'));
      await waitFor(() => expect(replaceRoles).toHaveBeenCalledTimes(2));
      expect(replaceRoles.mock.calls[1]![0]).toMatchObject({
        params: { body: { roleIds: ['r1', 'r2'], expectedRoleIds: ['r1'] } },
      });
    });
  });
});
