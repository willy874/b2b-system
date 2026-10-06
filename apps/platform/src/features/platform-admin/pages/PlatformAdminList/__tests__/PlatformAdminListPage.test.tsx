import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerPlatformAdminPagePermissions, Routes } from '../../..';
import { platformAdminFixture, platformProfileFixture } from '../../../test-fixtures';

const { listAdmins, getProfile, createAdmin, updateAdmin, sendPasswordLink } = vi.hoisted(() => ({
  listAdmins: vi.fn(),
  getProfile: vi.fn(),
  createAdmin: vi.fn(),
  updateAdmin: vi.fn(),
  sendPasswordLink: vi.fn(),
}));
vi.mock('@/apis/platform-admin/get-admin-list/query', () => ({
  PLATFORM_ADMIN_LIST_QUERY_KEY: 'PLATFORM_ADMIN_LIST_QUERY_KEY',
  getAdminListQueryOptions: () => ({
    queryKey: ['PLATFORM_ADMIN_LIST_QUERY_KEY'],
    queryFn: listAdmins,
  }),
}));
vi.mock('@/apis/auth/get-profile/query', () => ({
  AUTH_PROFILE_QUERY_KEY: 'AUTH_PROFILE_QUERY_KEY',
  getAuthProfileQueryOptions: () => ({ queryKey: ['AUTH_PROFILE_QUERY_KEY'], queryFn: getProfile }),
}));
vi.mock('@/apis/platform-admin/create-admin/mutation', () => ({
  getCreateAdminMutationOptions: () => ({ mutationFn: createAdmin }),
}));
vi.mock('@/apis/platform-admin/update-admin/mutation', () => ({
  getUpdateAdminMutationOptions: () => ({ mutationFn: updateAdmin }),
}));
vi.mock('@/apis/platform-admin/send-admin-password-link/mutation', () => ({
  getSendAdminPasswordLinkMutationOptions: () => ({ mutationFn: sendPasswordLink }),
}));

const SELF = platformAdminFixture({
  id: '77777777-7777-4777-8777-777777777777',
  email: 'root@platform.test',
  displayName: '超級管理者',
  role: 'super-admin',
});
const OTHER = platformAdminFixture();
const PENDING = platformAdminFixture({
  id: '88888888-8888-4888-8888-888888888888',
  email: 'new@platform.test',
  status: 'pending',
  lastLoginAt: null,
});

const ALL: PermissionKey[] = ['platformAdmin:read', 'platformAdmin:create', 'platformAdmin:update'];

function renderPage(permissions: PermissionKey[] | 'unhydrated', path = '/admin') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.PlatformAdminListRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

const byTestIdAndValue = (testId: string, value: string) =>
  screen
    .getAllByTestId(testId)
    .find((element) => element.getAttribute('data-value') === value) as HTMLElement;

/** 開啟 Select 並點選某個選項（列以 `select-item` ＋ `data-value` 定位）。 */
async function pickOption(selectTestId: string, value: string) {
  await userEvent.click(screen.getByTestId(selectTestId));
  const item = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="select-item"][data-value="${value}"]`,
    );
    if (!element) throw new Error(`找不到 select-item（data-value="${value}"）`);
    return element;
  });
  await userEvent.click(item);
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerPlatformAdminPagePermissions();
  listAdmins.mockReset().mockResolvedValue({ items: [SELF, OTHER, PENDING] });
  getProfile.mockReset().mockResolvedValue(platformProfileFixture(SELF));
  createAdmin.mockReset();
  updateAdmin.mockReset();
  sendPasswordLink.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('平台管理者清單', () => {
  it('全部權限 → 顯示清單、新增按鈕與每列的編輯、寄連結', async () => {
    renderPage(ALL);
    await screen.findAllByTestId('platform-admin-email');
    expect(byTestIdAndValue('platform-admin-role', 'super-admin')).toBeInTheDocument();
    expect(byTestIdAndValue('platform-admin-status', 'pending')).toBeInTheDocument();
    expect(screen.getByTestId('platform-admin-create-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('platform-admin-edit')).toHaveLength(3);
    expect(screen.getAllByTestId('platform-admin-password-link')).toHaveLength(3);
    expect(await screen.findByTestId('platform-admin-self')).toBeInTheDocument();
  });

  it('只有 platformAdmin:read → 看得到清單，沒有任何操作', async () => {
    renderPage(['platformAdmin:read']);
    expect(await screen.findAllByTestId('platform-admin-email')).toHaveLength(3);
    expect(screen.queryByTestId('platform-admin-create-button')).toBeNull();
    expect(screen.queryByTestId('platform-admin-edit')).toBeNull();
    expect(screen.queryByTestId('platform-admin-password-link')).toBeNull();
  });

  it('權限未水合 → 不閃現任何操作', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('platform-admin-page')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-admin-create-button')).toBeNull();
    expect(screen.queryByTestId('platform-admin-edit')).toBeNull();
    expect(screen.queryByTestId('platform-admin-password-link')).toBeNull();
  });

  it('網址帶關鍵字 → 只列出名稱或 email 符合的人', async () => {
    renderPage(ALL, '/admin?keyword=NEW%40');
    await waitFor(() =>
      expect(screen.getAllByTestId('platform-admin-email').map((el) => el.dataset.value)).toEqual([
        PENDING.email,
      ]),
    );
    expect(screen.getByTestId('table-search')).toHaveValue('NEW@');
  });

  it('在搜尋框輸入 → 篩選列表；沒有符合的顯示清除篩選', async () => {
    renderPage(ALL);
    await screen.findAllByTestId('platform-admin-email');
    fireEvent.change(screen.getByTestId('table-search'), { target: { value: '超級' } });
    await waitFor(() =>
      expect(screen.getAllByTestId('platform-admin-email').map((el) => el.dataset.value)).toEqual([
        SELF.email,
      ]),
    );
    fireEvent.change(screen.getByTestId('table-search'), { target: { value: 'nobody' } });
    expect(await screen.findByTestId('rich-table-clear-filters')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-admin-email')).toBeNull();
  });

  it('新增：檢查 email；送出正規化後的 email、名稱與選的角色', async () => {
    createAdmin.mockResolvedValue(platformAdminFixture({ status: 'pending' }));
    renderPage(ALL);
    fireEvent.click(await screen.findByTestId('platform-admin-create-button'));

    fireEvent.change(screen.getByTestId('platform-admin-email-input'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByTestId('platform-admin-display-name-input'), {
      target: { value: ' 新同事 ' },
    });
    fireEvent.click(screen.getByTestId('platform-admin-create-submit'));
    expect(createAdmin).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('platform-admin-email-input'), {
      target: { value: ' New@Platform.Test ' },
    });
    await pickOption('platform-admin-role-select', 'operator');
    fireEvent.click(screen.getByTestId('platform-admin-create-submit'));
    await waitFor(() => expect(createAdmin).toHaveBeenCalled());
    expect(createAdmin.mock.calls[0]?.[0]).toEqual({
      params: { email: 'new@platform.test', displayName: '新同事', role: 'operator' },
    });
  });

  it('編輯自己 → 只能改名稱，沒有角色與狀態', async () => {
    renderPage(ALL);
    await screen.findByTestId('platform-admin-self');
    fireEvent.click(byTestIdAndValue('platform-admin-edit', SELF.email));
    expect(await screen.findByTestId('platform-admin-edit-display-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('platform-admin-edit-self-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-admin-edit-role-select')).toBeNull();
    expect(screen.queryByTestId('platform-admin-edit-status-select')).toBeNull();
  });

  it('編輯待啟用的人 → 能改角色，不能改狀態', async () => {
    renderPage(ALL);
    await screen.findByTestId('platform-admin-self');
    fireEvent.click(byTestIdAndValue('platform-admin-edit', PENDING.email));
    expect(await screen.findByTestId('platform-admin-edit-role-select')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-admin-edit-status-select')).toBeNull();
    expect(screen.getByTestId('platform-admin-edit-pending-hint')).toBeInTheDocument();
  });

  it('編輯別人 → 只送出有改的欄位', async () => {
    updateAdmin.mockResolvedValue({ ...OTHER, status: 'inactive' });
    renderPage(ALL);
    await screen.findByTestId('platform-admin-self');
    fireEvent.click(byTestIdAndValue('platform-admin-edit', OTHER.email));
    await screen.findByTestId('platform-admin-edit-status-select');
    await pickOption('platform-admin-edit-status-select', 'inactive');
    fireEvent.click(screen.getByTestId('platform-admin-edit-submit'));
    await waitFor(() => expect(updateAdmin).toHaveBeenCalled());
    expect(updateAdmin.mock.calls[0]?.[0]).toEqual({
      params: { id: OTHER.id, body: { status: 'inactive' } },
    });
  });

  it('寄設定密碼連結要先確認', async () => {
    sendPasswordLink.mockResolvedValue({ purpose: 'passwordReset' });
    renderPage(ALL);
    await screen.findAllByTestId('platform-admin-password-link');
    fireEvent.click(byTestIdAndValue('platform-admin-password-link', OTHER.email));
    expect(sendPasswordLink).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(sendPasswordLink).toHaveBeenCalled());
    expect(sendPasswordLink.mock.calls[0]?.[0]).toEqual({ params: { id: OTHER.id } });
  });

  describe('對話框的未儲存提醒', () => {
    it('新增時輸入 email 後按 Esc：先確認；選「繼續編輯」後輸入還在', async () => {
      renderPage(ALL);
      fireEvent.click(await screen.findByTestId('platform-admin-create-button'));
      const input = screen.getByTestId('platform-admin-email-input');
      fireEvent.change(input, { target: { value: 'new@platform.test' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('platform-admin-email-input')).toHaveValue('new@platform.test');
    });

    it('新增時沒有輸入按取消：直接關閉', async () => {
      renderPage(ALL);
      fireEvent.click(await screen.findByTestId('platform-admin-create-button'));
      fireEvent.click(screen.getByTestId('platform-admin-create-cancel'));
      await waitFor(() => expect(screen.queryByTestId('platform-admin-create-dialog')).toBeNull());
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });

    it('編輯時改了名稱按取消：選「放棄變更」才關閉', async () => {
      renderPage(ALL);
      await screen.findByTestId('platform-admin-self');
      fireEvent.click(byTestIdAndValue('platform-admin-edit', OTHER.email));
      fireEvent.change(await screen.findByTestId('platform-admin-edit-display-name-input'), {
        target: { value: '改過的名稱' },
      });
      fireEvent.click(screen.getByTestId('platform-admin-edit-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(screen.queryByTestId('platform-admin-edit-dialog')).toBeNull());
      expect(updateAdmin).not.toHaveBeenCalled();
    });
  });
});
