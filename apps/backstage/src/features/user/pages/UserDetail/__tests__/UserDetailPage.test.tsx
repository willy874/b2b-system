import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

const {
  fetchUser,
  fetchProfile,
  updateUser,
  unlockUser,
  fetchGroups,
  fetchSources,
  fetchOrgUnits,
} = vi.hoisted(() => ({
  fetchOrgUnits: vi.fn(),
  fetchSources: vi.fn(),
  fetchGroups: vi.fn(),
  fetchUser: vi.fn(),
  fetchProfile: vi.fn(),
  updateUser: vi.fn(),
  unlockUser: vi.fn(),
}));
vi.mock('@/apis/user/get-user-detail/fetcher', () => ({ fetchUserDetailQuery: fetchUser }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/update-user/fetcher', () => ({ fetchUserUpdateMutation: updateUser }));
vi.mock('@/apis/user/unlock-user/fetcher', () => ({ fetchUserUnlockMutation: unlockUser }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/org-unit/get-user-org-units/fetcher', () => ({
  fetchUserOrgUnitsQuery: fetchOrgUnits,
}));
vi.mock('@/apis/user/get-user-permission-sources/fetcher', () => ({
  fetchUserPermissionSourcesQuery: fetchSources,
}));

const USER_ID = '44444444-4444-4444-8444-444444444444';
const PATH = `/user/${USER_ID}`;
const base = {
  id: USER_ID,
  email: 'p@acme.test',
  username: null,
  displayName: 'Person',
  roles: [],
  tags: [],
  lastLoginAt: null,
  version: 3,
  createdAt: '2026-09-30T00:00:00.000Z',
};
const EDITOR = ['user:read', 'user:update'] as PermissionKey[];

Routes.UserListRoute.update({ component: Outlet });
const routes = [Routes.UserListRoute.addChildren([Routes.UserDetailRoute])];

beforeAll(() => initTestI18n(userZhTW));

afterEach(() => resetFeatureStore());

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  // 群組是可啟用的 feature（docs/architecture/iam/07-groups.md §8）：預設已啟用
  featureStore.setState({ resolved: true, statuses: new Map([['group', 'ready']]) });
  fetchUser.mockReset().mockResolvedValue({ ...base, status: 'active' });
  fetchProfile.mockReset().mockResolvedValue({ user: { id: 'me' }, permissions: [] });
  updateUser.mockReset().mockImplementation(async ({ params }) => ({ ...base, ...params.body }));
  unlockUser.mockReset().mockResolvedValue({ ...base, status: 'active' });
  fetchSources.mockReset().mockResolvedValue({
    isSuperAdmin: false,
    superAdminVia: null,
    items: [
      {
        key: 'file:read',
        nameI18nKey: 'permission.file.read',
        resource: 'file',
        resourceNameI18nKey: 'permission.resource.file',
        includes: [],
        requires: [],
        sources: [
          {
            grantedKey: 'file:update',
            grantedNameI18nKey: 'permission.file.update',
            via: [
              { type: 'user', id: USER_ID, relation: '', name: 'Person', hidden: false },
              { type: 'role', id: 'r1', relation: 'holder', name: 'Editor', hidden: false },
            ],
          },
        ],
      },
    ],
  });
  fetchGroups.mockReset().mockResolvedValue({
    items: [
      { id: 'g-art', name: '美術', memberCount: 1, roleCount: 1, version: 1, membership: 'nested' },
      {
        id: 'g-design',
        name: '角色設計',
        memberCount: 1,
        roleCount: 0,
        version: 1,
        membership: 'direct',
      },
    ],
    pagination: { total: 2 },
  });
  fetchOrgUnits.mockReset().mockResolvedValue({
    items: [
      {
        unitId: 'ou-north',
        name: '北區',
        path: [
          { id: 'ou-hq', name: '總公司' },
          { id: 'ou-sales', name: '業務部' },
        ],
        isManager: true,
        isPrimary: true,
        title: '經理',
      },
    ],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

const conflict = () => new AppError('USER_VERSION_CONFLICT', 409, { current: 4 });

async function startEditing() {
  fireEvent.click(await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 }));
  return screen.getByTestId('user-display-name-edit-input');
}

describe('UserDetailPage', () => {
  it('標籤：看得到使用者就看得到標籤；有 user:update 才能編輯（docs/architecture/backend/18-tag.md §7.2 D5）', async () => {
    fetchUser.mockResolvedValue({
      ...base,
      status: 'active',
      tags: [{ id: 't1', name: '研發部', color: 'brand' }],
    });
    const { unmount } = renderRoute(routes, PATH, ['user:read'] as PermissionKey[]);
    const section = await screen.findByTestId('user-tag-section', undefined, { timeout: 5000 });
    expect(within(section).getByTestId('tag-chip')).toHaveTextContent('研發部');
    expect(within(section).queryByTestId('user-tag-edit-button')).toBeNull();
    unmount();

    renderRoute(routes, PATH, EDITOR);
    expect(await screen.findByTestId('user-tag-edit-button')).toBeInTheDocument();
  });

  it('鎖定的使用者只改顯示名稱：只送出名稱，不會順便解鎖', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    const input = await startEditing();
    expect(screen.queryByTestId('user-status-select')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.submit(screen.getByTestId('user-edit-form'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({
      displayName: 'Renamed',
      version: 3,
    });
  });

  it('鎖定的使用者另有明確的「解鎖」按鈕', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    fireEvent.click(
      await screen.findByTestId('user-detail-unlock-button', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(unlockUser).toHaveBeenCalledTimes(1));
  });

  it('鎖定狀態在詳情與列表同樣是 danger 色調', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    expect(
      await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 }),
    ).toHaveAttribute('data-tone', 'danger');
  });

  it('改成停用會先確認，確認後才送出', async () => {
    renderRoute(routes, PATH, EDITOR);

    await startEditing();
    fireEvent.click(screen.getByTestId('user-status-select'));
    fireEvent.click(await screen.findByRole('option', { name: '停用' }));
    fireEvent.click(screen.getByTestId('user-save-button'));

    const confirm = await screen.findByTestId('user-deactivate-confirm');
    expect(confirm).toHaveTextContent('立即被登出');
    expect(updateUser).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({ status: 'inactive', version: 3 });
  });

  describe('樂觀鎖（docs/architecture/backend/03-api-conventions.md §11）', () => {
    it('別人已改過 → 表單上說明並保留輸入，不彈錯誤 toast', async () => {
      updateUser.mockRejectedValue(conflict());
      renderRoute(routes, PATH, EDITOR);

      const input = await startEditing();
      fireEvent.change(input, { target: { value: 'Mine' } });
      fireEvent.submit(screen.getByTestId('user-edit-form'));

      expect(await screen.findByTestId('version-conflict-alert')).toHaveTextContent(
        '已經被其他人修改',
      );
      expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Mine');
      expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    });

    it('按「重新載入」→ 表單換成最新的內容，再次送出帶最新的 version', async () => {
      updateUser.mockRejectedValueOnce(conflict());
      renderRoute(routes, PATH, EDITOR);

      const input = await startEditing();
      fireEvent.change(input, { target: { value: 'Mine' } });
      fireEvent.submit(screen.getByTestId('user-edit-form'));
      await screen.findByTestId('version-conflict-alert');

      fetchUser.mockResolvedValue({ ...base, status: 'active', displayName: 'Theirs', version: 4 });
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      await waitFor(() =>
        expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Theirs'),
      );
      expect(screen.queryByTestId('version-conflict-alert')).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId('user-display-name-edit-input'), {
        target: { value: 'Mine again' },
      });
      fireEvent.submit(screen.getByTestId('user-edit-form'));
      await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
      expect(updateUser.mock.calls[1]![0].params.body).toEqual({
        displayName: 'Mine again',
        version: 4,
      });
    });

    it('停用時衝突 → 關掉確認框，衝突訊息顯示在表單上', async () => {
      updateUser.mockRejectedValue(conflict());
      renderRoute(routes, PATH, EDITOR);

      await startEditing();
      fireEvent.click(screen.getByTestId('user-status-select'));
      fireEvent.click(await screen.findByRole('option', { name: '停用' }));
      fireEvent.click(screen.getByTestId('user-save-button'));
      fireEvent.click(
        within(await screen.findByTestId('user-deactivate-confirm')).getByTestId(
          'alert-dialog-confirm',
        ),
      );

      expect(await screen.findByTestId('version-conflict-alert')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByTestId('user-deactivate-confirm')).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId('user-edit-form')).toBeInTheDocument();
    });
  });

  it('儲存失敗時編輯區與輸入保留', async () => {
    updateUser.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, PATH, EDITOR);

    const input = await startEditing();
    fireEvent.change(input, { target: { value: 'Keep me' } });
    fireEvent.submit(screen.getByTestId('user-edit-form'));

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
    expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Keep me');
  });

  it('使用者不存在時說明原因並提供回到列表', async () => {
    fetchUser.mockRejectedValue(new AppError('USER_NOT_FOUND', 404));
    const { router } = renderRoute(routes, PATH, EDITOR);

    const error = await screen.findByTestId('user-detail-error', undefined, { timeout: 5000 });
    expect(error).toHaveTextContent('找不到');
    fireEvent.click(screen.getByTestId('user-detail-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/user'));
  });

  it('沒有 user:update → 不顯示編輯與解鎖', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, ['user:read'] as PermissionKey[]);

    await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-detail-unlock-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現編輯', async () => {
    renderRoute(routes, PATH, 'unhydrated');

    await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-edit-button')).not.toBeInTheDocument();
  });

  it('有 group:read → 列出所屬群組，直接所屬的在前（docs/architecture/iam/01-model.md §9 G4）', async () => {
    renderRoute(routes, PATH, ['user:read', 'group:read'] as PermissionKey[]);
    const groups = await screen.findAllByTestId('user-group', undefined, { timeout: 5000 });
    expect(groups.map((group) => group.getAttribute('data-value'))).toEqual(['g-design', 'g-art']);
    expect(fetchGroups.mock.calls[0]![0].params).toMatchObject({ userId: USER_ID });
  });

  it('沒有 group:read → 不顯示所屬群組', async () => {
    renderRoute(routes, PATH, EDITOR);
    await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-group-section')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it('租戶沒有啟用 group → 有 group:read 也不顯示所屬群組、不查', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['group', 'disabled']]) });
    renderRoute(routes, PATH, ['user:read', 'user:update', 'group:read'] as PermissionKey[]);
    await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-group-section')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it('看自己：「有效權限」打開對話框才查；清單點一個權限，同一個對話框顯示來源（docs/architecture/iam/08-explain.md §5）', async () => {
    fetchProfile.mockResolvedValue({ user: { id: USER_ID }, permissions: [] });
    renderRoute(routes, PATH, ['user:read'] as PermissionKey[]);
    fireEvent.click(
      await screen.findByTestId('user-permission-sources-show', undefined, { timeout: 5000 }),
    );
    const list = await screen.findByTestId('permission-source-dialog');
    const item = await within(list).findByTestId('permission-source');
    expect(item).toHaveAttribute('data-value', 'file:read');
    expect(item).toHaveTextContent('檢視檔案');
    expect(item).toHaveTextContent('1 個來源');
    // 唯一的來源是 file:update：只由依賴帶出
    expect(item).toHaveTextContent('依賴帶出');

    fireEvent.click(item);
    expect(item).toHaveAttribute('aria-current', 'true');
    const viewer = await within(list).findByTestId('permission-source-viewer');
    expect(within(viewer).getByTestId('permission-source-path')).toHaveTextContent(
      '由「編輯檔案」帶出',
    );
    expect(fetchSources.mock.calls[0]![0].params).toEqual({ userId: USER_ID });
  });

  it('看別人、沒有 authz:explain → 不顯示「有效權限」', async () => {
    renderRoute(routes, PATH, EDITOR);
    await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-permission-sources')).not.toBeInTheDocument();
  });

  it('看別人、有 authz:explain → 顯示「有效權限」', async () => {
    renderRoute(routes, PATH, ['user:read', 'authz:explain'] as PermissionKey[]);
    expect(
      await screen.findByTestId('user-permission-sources', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(fetchSources).not.toHaveBeenCalled();
  });

  it('所屬群組查詢失敗 → 顯示原因與重試，不顯示「無」', async () => {
    fetchGroups.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, PATH, ['user:read', 'group:read'] as PermissionKey[]);

    const error = await screen.findByTestId('user-group-error', undefined, { timeout: 5000 });
    expect(within(screen.getByTestId('user-group-section')).queryByText('無')).toBeNull();

    fetchGroups.mockResolvedValue({ items: [], pagination: { total: 0 } });
    fireEvent.click(within(error).getByTestId('user-group-retry'));
    await waitFor(() => expect(screen.queryByTestId('user-group-error')).toBeNull());
  });
});

/** 租戶啟用 organization（群組照舊啟用）。 */
const enableOrganization = () =>
  featureStore.setState({
    resolved: true,
    statuses: new Map([
      ['group', 'ready'],
      ['organization', 'ready'],
    ]),
  });

describe('UserDetailPage 的所屬部門（docs/architecture/backend/23-organization.md §8）', () => {
  it('租戶啟用 organization、有 orgUnit:read → 列出部門、上層路徑、主管與職稱', async () => {
    enableOrganization();
    renderRoute(routes, PATH, ['user:read', 'orgUnit:read'] as PermissionKey[]);
    const unit = await screen.findByTestId('user-org-unit', undefined, { timeout: 5000 });
    expect(unit).toHaveAttribute('data-value', 'ou-north');
    expect(unit).toHaveTextContent('總公司 / 業務部 /');
    expect(unit).toHaveTextContent('主要部門');
    expect(unit).toHaveTextContent('主管');
    expect(unit).toHaveTextContent('經理');
    expect(fetchOrgUnits.mock.calls[0]![0].params).toEqual({ userId: USER_ID });
  });

  it('租戶沒有啟用 organization → 有 orgUnit:read 也不顯示、不查', async () => {
    renderRoute(routes, PATH, ['user:read', 'group:read', 'orgUnit:read'] as PermissionKey[]);
    await screen.findByTestId('user-group-section', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-org-unit-section')).not.toBeInTheDocument();
    expect(fetchOrgUnits).not.toHaveBeenCalled();
  });

  it('沒有 orgUnit:read → 不顯示', async () => {
    enableOrganization();
    renderRoute(routes, PATH, ['user:read', 'group:read'] as PermissionKey[]);
    await screen.findByTestId('user-group-section', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-org-unit-section')).not.toBeInTheDocument();
  });
});

describe('UserDetailPage 的基本資料（UserBasicSection）', () => {
  it('沒有改任何欄位就儲存 → 直接回到檢視，不送出', async () => {
    renderRoute(routes, PATH, EDITOR);
    await startEditing();
    fireEvent.submit(screen.getByTestId('user-edit-form'));
    await waitFor(() => expect(screen.queryByTestId('user-edit-form')).toBeNull());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('開始編輯時聚焦顯示名稱；取消回到檢視', async () => {
    renderRoute(routes, PATH, EDITOR);
    const input = await startEditing();
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.click(
      within(screen.getByTestId('user-edit-form')).getByRole('button', { name: '取消' }),
    );
    expect(screen.queryByTestId('user-edit-form')).toBeNull();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('已停用的人改回啟用 → 不必確認，直接送出', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'inactive' });
    renderRoute(routes, PATH, EDITOR);
    await startEditing();
    fireEvent.click(screen.getByTestId('user-status-select'));
    fireEvent.click(await screen.findByRole('option', { name: '啟用' }));
    fireEvent.click(screen.getByTestId('user-save-button'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({ status: 'active', version: 3 });
    expect(screen.queryByTestId('user-deactivate-confirm')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('user-edit-form')).toBeNull());
  });

  it('停用時其他錯誤 → 留在確認框讓人重試，編輯區保留', async () => {
    updateUser.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, PATH, EDITOR);
    await startEditing();
    fireEvent.click(screen.getByTestId('user-status-select'));
    fireEvent.click(await screen.findByRole('option', { name: '停用' }));
    fireEvent.click(screen.getByTestId('user-save-button'));
    const confirm = await screen.findByTestId('user-deactivate-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('user-deactivate-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('user-edit-form')).toBeInTheDocument();
  });

  it('停用的確認按取消 → 不送出，編輯區保留', async () => {
    renderRoute(routes, PATH, EDITOR);
    await startEditing();
    fireEvent.click(screen.getByTestId('user-status-select'));
    fireEvent.click(await screen.findByRole('option', { name: '停用' }));
    fireEvent.click(screen.getByTestId('user-save-button'));
    fireEvent.click(
      within(await screen.findByTestId('user-deactivate-confirm')).getByTestId(
        'alert-dialog-cancel',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('user-deactivate-confirm')).toBeNull());
    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('user-edit-form')).toBeInTheDocument();
  });

  it('重新載入失敗 → 以 toast 顯示錯誤', async () => {
    updateUser.mockRejectedValueOnce(conflict());
    renderRoute(routes, PATH, EDITOR);
    const input = await startEditing();
    fireEvent.change(input, { target: { value: 'Mine' } });
    fireEvent.submit(screen.getByTestId('user-edit-form'));
    await screen.findByTestId('version-conflict-alert');

    fetchUser.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
  });
});
