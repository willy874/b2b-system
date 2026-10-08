import { setActiveBatchQueue } from '@b2b-system/web-core/batch';
import { AppError } from '@b2b-system/web-core/errors';
import { createFakeBatchQueue, renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

const { fetchUsers, fetchProfile, resetPassword, fetchTags, deleteUser, fetchTree, fetchUser } =
  vi.hoisted(() => ({
    deleteUser: vi.fn(),
    fetchTree: vi.fn(),
    fetchUser: vi.fn(),
    fetchUsers: vi.fn(),
    fetchProfile: vi.fn(),
    resetPassword: vi.fn(),
    fetchTags: vi.fn(),
  }));
vi.mock('@/apis/tag/get-tag-list/fetcher', () => ({ fetchTagListQuery: fetchTags }));
vi.mock('@/apis/user/delete-user/fetcher', () => ({ fetchUserDeleteMutation: deleteUser }));
vi.mock('@/apis/org-unit/get-org-unit-tree/fetcher', () => ({ fetchOrgUnitTreeQuery: fetchTree }));
vi.mock('@/apis/user/get-user-detail/fetcher', () => ({ fetchUserDetailQuery: fetchUser }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/reset-user-password/fetcher', () => ({
  fetchUserResetPasswordMutation: resetPassword,
}));

const USER = {
  id: 'u1',
  email: 'locked@acme.test',
  username: null,
  displayName: 'Locked Person',
  status: 'locked',
  roles: [],
  tags: [{ id: 't1', name: '研發部', color: 'brand' }],
  lastLoginAt: null,
  createdAt: '2026-09-30T00:00:00.000Z',
};
const ADMIN = ['user:read', 'user:update', 'user:resetPassword', 'user:delete'] as PermissionKey[];
const routes = [Routes.UserListRoute];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  fetchTags.mockReset().mockResolvedValue({ items: [] });
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  fetchUsers.mockReset().mockResolvedValue({ items: [USER], pagination: { total: 1 } });
  fetchProfile.mockReset().mockResolvedValue({ user: { id: 'me' }, permissions: [] });
  resetPassword.mockReset().mockResolvedValue(undefined);
  deleteUser.mockReset().mockResolvedValue(undefined);
  fetchTree.mockReset().mockResolvedValue({ items: [] });
  // 詳情在這些測試裡不重要：維持載入中
  fetchUser.mockReset().mockReturnValue(new Promise(() => {}));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('UserListPage 的匯出、匯入入口（docs/architecture/backend/22-data-transfer.md §8.2）', () => {
  beforeEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
  });

  it('有 user:export、user:update → 顯示「匯出」「匯入」', async () => {
    renderRoute(routes, '/user', [...ADMIN, 'user:export'] as PermissionKey[]);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.getByTestId('user-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('user-import-button')).toBeInTheDocument();
  });

  it('只有 user:read → 兩個入口都不顯示', async () => {
    renderRoute(routes, '/user', ['user:read'] as PermissionKey[]);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-export-button')).toBeNull();
    expect(screen.queryByTestId('user-import-button')).toBeNull();
  });

  it('租戶沒有啟用 dataTransfer → 有權限也不顯示', async () => {
    featureStore.setState({ resolved: true, statuses: new Map() });
    renderRoute(routes, '/user', [...ADMIN, 'user:export'] as PermissionKey[]);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-export-button')).toBeNull();
  });

  it('權限未水合 → 不閃現', async () => {
    renderRoute(routes, '/user', 'unhydrated');
    expect(screen.queryByTestId('user-export-button')).toBeNull();
    expect(screen.queryByTestId('user-import-button')).toBeNull();
  });
});

describe('UserListPage', () => {
  it('標籤欄顯示貼著的標籤；依標籤篩選以 tagId 查詢（docs/architecture/backend/18-tag.md §7.2 D6）', async () => {
    renderRoute(routes, '/user?tagId=11111111-1111-4111-8111-111111111111', ADMIN);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.getByTestId('tag-chip')).toHaveTextContent('研發部');
    expect(fetchUsers.mock.calls.at(-1)![0]).toMatchObject({
      params: { tagId: ['11111111-1111-4111-8111-111111111111'] },
    });
  });

  it('重設密碼先確認寄到哪個 Email；確認後才寄出，且只寄一次', async () => {
    renderRoute(routes, '/user', ADMIN);
    // 第一次載入 lazy 頁面比較久
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });

    fireEvent.click(screen.getByTestId('user-reset-password-button'));
    const confirm = await screen.findByTestId('user-reset-password-confirm');
    expect(confirm).toHaveTextContent('locked@acme.test');
    expect(resetPassword).not.toHaveBeenCalled();

    const submit = within(confirm).getByTestId('alert-dialog-confirm');
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByTestId('user-reset-password-confirm')).not.toBeInTheDocument(),
    );
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });

  it('取消確認就不寄信', async () => {
    renderRoute(routes, '/user', ADMIN);

    fireEvent.click(await screen.findByTestId('user-reset-password-button'));
    fireEvent.click(await screen.findByTestId('alert-dialog-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('user-reset-password-confirm')).not.toBeInTheDocument(),
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('列表查詢失敗時顯示錯誤與重試，不是「沒有資料」', async () => {
    fetchUsers.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/user', ADMIN);

    const error = await screen.findByTestId('rich-table-error');
    expect(screen.queryByText('沒有資料')).not.toBeInTheDocument();
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findByText('Locked Person')).toBeInTheDocument();
  });

  it('搜尋框常駐在列表上方，帶入網址上的關鍵字', async () => {
    renderRoute(routes, '/user?keyword=locked', ADMIN);

    expect(await screen.findByTestId('table-search')).toHaveValue('locked');
  });

  it('鎖定狀態在列表是 danger 色調（與詳情一致）', async () => {
    renderRoute(routes, '/user', ADMIN);

    const row = (await screen.findByText('Locked Person')).closest('tr') as HTMLElement;
    expect(within(row).getByText('鎖定')).toHaveAttribute('data-tone', 'danger');
  });

  it('沒有 user:resetPassword → 不顯示重設密碼', async () => {
    renderRoute(routes, '/user', ['user:read'] as PermissionKey[]);

    await screen.findByText('Locked Person');
    expect(screen.queryByTestId('user-reset-password-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現重設密碼', async () => {
    renderRoute(routes, '/user', 'unhydrated');

    await screen.findByText('Locked Person');
    expect(screen.queryByTestId('user-reset-password-button')).not.toBeInTheDocument();
  });
});

describe('UserListPage：選取全部符合的 N 筆（docs/architecture/frontend/07-ui-system.md §13.7）', () => {
  let queue: ReturnType<typeof createFakeBatchQueue>;
  const TOTAL = 250;

  beforeEach(async () => {
    queue = createFakeBatchQueue();
    const tab = queue.openTab('this-tab');
    await tab.start();
    setActiveBatchQueue(tab);
    // 列表一頁 1 筆（總數 250）；收集時（limit 200）依 offset 回傳那一段
    fetchUsers.mockImplementation(
      async ({ params }: { params: { offset: number; limit: number } }) => {
        if (params.limit !== 200) return { items: [USER], pagination: { total: TOTAL } };
        const count = Math.max(0, Math.min(params.limit, TOTAL - params.offset));
        return {
          items: Array.from({ length: count }, (_, index) => ({
            ...USER,
            id: `u${params.offset + index}`,
            status: 'active',
          })),
          pagination: { total: TOTAL },
        };
      },
    );
  });

  afterEach(() => {
    setActiveBatchQueue(undefined);
    queue.dispose();
  });

  it('整頁勾選 → 選取全部符合；執行時以同樣的篩選逐頁收集，確認的筆數是總數', async () => {
    renderRoute(routes, '/user?keyword=acme', ADMIN);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });

    fireEvent.click(screen.getByTestId('table-select-row'));
    fireEvent.click(await screen.findByTestId('batch-select-all-matching'));
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute(
      'data-value',
      String(TOTAL),
    );

    const deactivate = screen
      .getAllByTestId('batch-action')
      .find((button) => button.getAttribute('data-value') === 'deactivate')!;
    fireEvent.click(deactivate);

    const dialog = await screen.findByTestId('batch-confirm-dialog');
    expect(dialog).toHaveTextContent(String(TOTAL));
    const collectCalls = fetchUsers.mock.calls
      .map(
        ([request]) =>
          (request as { params: { offset: number; limit: number; keyword?: string } }).params,
      )
      .filter((params) => params.limit === 200);
    expect(collectCalls).toEqual([
      expect.objectContaining({ offset: 0, limit: 200, keyword: 'acme' }),
      expect.objectContaining({ offset: 200, limit: 200, keyword: 'acme' }),
    ]);
    fireEvent.click(within(dialog).getByTestId('alert-dialog-cancel'));
  });
});

describe('UserListPage 的刪除與導覽', () => {
  afterEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map() });
  });

  it('刪除先確認，確認後呼叫刪除並關閉', async () => {
    renderRoute(routes, '/user', ADMIN);
    fireEvent.click(await screen.findByTestId('user-delete-button', undefined, { timeout: 5000 }));
    const confirm = await screen.findByTestId('user-delete-confirm');
    expect(confirm).toHaveTextContent('Locked Person');
    expect(deleteUser).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledTimes(1));
    expect(deleteUser.mock.calls[0]![0]).toMatchObject({ params: { userId: 'u1' } });
    await waitFor(() => expect(screen.queryByTestId('user-delete-confirm')).toBeNull());
  });

  it('刪除失敗（錯誤由 mutation 顯示）也關閉確認框', async () => {
    deleteUser.mockRejectedValue(new AppError('USER_NOT_FOUND', 404));
    renderRoute(routes, '/user', ADMIN);
    fireEvent.click(await screen.findByTestId('user-delete-button', undefined, { timeout: 5000 }));
    fireEvent.click(
      within(await screen.findByTestId('user-delete-confirm')).getByTestId('alert-dialog-confirm'),
    );
    await waitFor(() => expect(screen.queryByTestId('user-delete-confirm')).toBeNull());
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('有 user:create → 顯示建立使用者；沒有就不顯示', async () => {
    const { unmount } = renderRoute(routes, '/user', [...ADMIN, 'user:create'] as PermissionKey[]);
    expect(
      await screen.findByTestId('user-create-button', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    unmount();

    renderRoute(routes, '/user', ADMIN);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-create-button')).toBeNull();
  });

  it('雙擊一列 → 打開那位使用者的詳情，保留列表的條件', async () => {
    const { router } = renderRoute(
      [Routes.UserListRoute.addChildren([Routes.UserDetailRoute])],
      '/user?keyword=locked',
      ADMIN,
    );
    const name = await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    fireEvent.doubleClick(name.closest('tr')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/user/u1'));
    expect(router.state.location.search).toMatchObject({ keyword: 'locked' });
  });

  it('組織管理啟用且有 orgUnit:read → 網址上的部門篩選帶進查詢', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['organization', 'ready']]) });
    renderRoute(
      routes,
      '/user?orgUnitId=11111111-1111-4111-8111-111111111111&includeDescendants=true',
      [...ADMIN, 'orgUnit:read'] as PermissionKey[],
    );
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(fetchTree).toHaveBeenCalled();
    expect(fetchUsers.mock.calls.at(-1)![0]).toMatchObject({
      params: {
        orgUnitId: '11111111-1111-4111-8111-111111111111',
        includeDescendants: true,
      },
    });
  });

  it('組織管理未啟用 → 不查部門樹，也不帶部門參數', async () => {
    renderRoute(routes, '/user?orgUnitId=11111111-1111-4111-8111-111111111111', [
      ...ADMIN,
      'orgUnit:read',
    ] as PermissionKey[]);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(fetchTree).not.toHaveBeenCalled();
    expect(fetchUsers.mock.calls.at(-1)![0]).toMatchObject({
      params: { orgUnitId: undefined, includeDescendants: false },
    });
  });
});
