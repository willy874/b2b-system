import { installFlowDom } from '@b2b-system/ui/testing';
import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';

const { fetchRole, fetchRolePermissions, fetchPermissionList, grant } = vi.hoisted(() => ({
  fetchRole: vi.fn(),
  fetchRolePermissions: vi.fn(),
  fetchPermissionList: vi.fn(),
  grant: vi.fn(),
}));
vi.mock('@/apis/role/get-role-detail/fetcher', () => ({ fetchRoleDetailQuery: fetchRole }));
vi.mock('@/apis/role/get-role-permissions/fetcher', () => ({
  fetchRolePermissionsQuery: fetchRolePermissions,
}));
vi.mock('@/apis/permission/get-permission-list/fetcher', () => ({
  fetchPermissionListQuery: fetchPermissionList,
}));
vi.mock('@/apis/role/grant-role-permissions/fetcher', () => ({
  fetchGrantRolePermissionsMutation: grant,
}));

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const PATH = `/role/${ROLE_ID}/permission`;
const MANAGER = [
  'role:read',
  'role:update',
  'role:grantPermission',
  'permission:read',
  'user:read',
  'user:update',
] as PermissionKey[];

// 列表與詳情換成只渲染子路由：這裡只測權限對話框本身
Routes.RoleListRoute.update({ component: Outlet });
Routes.RoleDetailRoute.update({ component: Outlet });
const routes = [
  Routes.RoleListRoute.addChildren([
    Routes.RoleDetailRoute.addChildren([Routes.RoleDetailPermissionRoute]),
  ]),
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 技能樹上的一個權限（節點內的按鈕）。 */
const node = (key: string) =>
  screen
    .getAllByTestId('role-permission-node')
    .find((element) => element.getAttribute('data-value') === key) as HTMLElement;

/** 技能樹預設收合：展開才掛上畫布。 */
const openTree = async () =>
  fireEvent.click(
    await screen.findByTestId('role-permission-tree-toggle', undefined, { timeout: 5000 }),
  );

beforeAll(() => initTestI18n(roleZhTW));
beforeAll(installFlowDom);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  fetchRole.mockReset().mockResolvedValue({
    id: ROLE_ID,
    slug: 'editor',
    name: 'Editor',
    isSystem: false,
  });
  fetchRolePermissions
    .mockReset()
    .mockResolvedValue({ permissions: [{ key: 'user:read' }], isSuperAdmin: false });
  fetchPermissionList.mockReset().mockResolvedValue({
    items: [
      {
        key: 'user:read',
        resource: 'user',
        nameI18nKey: 'permission.user.read',
        includes: [],
        requires: [],
      },
      {
        key: 'user:update',
        resource: 'user',
        nameI18nKey: 'permission.user.update',
        includes: ['user:read'],
        requires: [],
      },
    ],
    groups: [
      {
        resource: 'user',
        nameI18nKey: 'permission.resource.user',
        keys: ['user:read', 'user:update'],
      },
    ],
  });
  grant.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('RoleDetailPermissionPage', () => {
  it('既有權限還在載入時不能勾選；載入後只送出實際的增減', async () => {
    const pending = deferred<{ permissions: { key: string }[]; isSuperAdmin: boolean }>();
    fetchRolePermissions.mockReturnValue(pending.promise);
    renderRoute(routes, PATH, MANAGER);

    expect(await screen.findByTestId('role-permission-loading')).toBeInTheDocument();
    expect(screen.queryAllByTestId('role-permission-node')).toHaveLength(0);
    expect(screen.getByTestId('role-permission-save')).toBeDisabled();

    pending.resolve({ permissions: [{ key: 'user:read' }], isSuperAdmin: false });
    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));

    expect(screen.getByTestId('role-permission-summary')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('role-permission-save'));

    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    expect(grant.mock.calls[0]![0]).toMatchObject({
      params: { roleId: ROLE_ID, body: { add: ['user:update'], remove: [] } },
    });
    await waitFor(() =>
      expect(screen.queryByTestId('role-permission-dialog')).not.toBeInTheDocument(),
    );
  });

  it('儲存失敗時對話框與勾選都保留，並顯示錯誤提示', async () => {
    grant.mockRejectedValue(new AppError('AUTHZ_ESCALATION', 403));
    renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));
    fireEvent.click(screen.getByTestId('role-permission-save'));

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
    expect(screen.getByTestId('role-permission-dialog')).toBeInTheDocument();
    expect(node('user:update')).toHaveAttribute('aria-pressed', 'true');
  });

  it('勾選後資料被重抓（推播）：送出的增減仍對開始編輯時的權限計算，並提示已被他人修改', async () => {
    const { queryClient } = renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));
    expect(screen.queryByTestId('role-permission-stale')).not.toBeInTheDocument();

    // 別人剛拿掉了 user:read：推播讓權限重抓
    act(() =>
      queryClient.setQueryData(getRolePermissionsQueryOptions(ROLE_ID).queryKey, {
        permissions: [],
        effective: [],
        isSuperAdmin: false,
      }),
    );
    expect(await screen.findByTestId('role-permission-stale')).toBeInTheDocument();
    expect(screen.getByTestId('role-permission-summary')).toHaveTextContent(
      '將新增 1 項、移除 0 項',
    );

    fireEvent.click(screen.getByTestId('role-permission-save'));
    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    // 只有自己勾的 user:update；別人剛拿掉的 user:read 不會被當成新增送回去
    expect(grant.mock.calls[0]![0]).toMatchObject({
      params: { roleId: ROLE_ID, body: { add: ['user:update'], remove: [] } },
    });
  });

  it('草稿過期時可以丟棄，改用最新的權限', async () => {
    const { queryClient } = renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));
    act(() =>
      queryClient.setQueryData(getRolePermissionsQueryOptions(ROLE_ID).queryKey, {
        permissions: [],
        effective: [],
        isSuperAdmin: false,
      }),
    );
    fireEvent.click(await screen.findByTestId('role-permission-discard'));

    expect(screen.queryByTestId('role-permission-stale')).not.toBeInTheDocument();
    expect(node('user:update')).toHaveAttribute('aria-pressed', 'false');
    expect(node('user:read')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('role-permission-save')).toBeDisabled();
  });

  it('有未儲存的勾選時按取消會先確認；選「繼續編輯」留在原處', async () => {
    renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));
    fireEvent.click(screen.getByTestId('role-permission-cancel'));

    const confirm = await screen.findByTestId('unsaved-changes-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('role-permission-dialog')).toBeInTheDocument();
    expect(node('user:update')).toHaveAttribute('aria-pressed', 'true');
  });

  it('沒有改動時按取消直接關閉，不跳確認', async () => {
    renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('role-permission-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('role-permission-dialog')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument();
  });

  it('沒有 role:grantPermission → 技能樹唯讀、不能儲存', async () => {
    renderRoute(
      routes,
      PATH,
      MANAGER.filter((key) => key !== 'role:grantPermission'),
    );

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    expect(node('user:update')).toBeDisabled();
    expect(screen.getByTestId('role-permission-save')).toBeDisabled();
  });

  it('權限未水合 → 不能儲存', async () => {
    renderRoute(routes, PATH, 'unhydrated');

    expect(await screen.findByTestId('role-permission-save')).toBeDisabled();
  });

  it('互鎖：點上層時前置自動成為「已包含」；有上層時不能取消前置，並說明原因', async () => {
    fetchRolePermissions.mockResolvedValue({ permissions: [], isSuperAdmin: false });
    renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    fireEvent.click(node('user:update'));
    expect(node('user:update')).toHaveAttribute('aria-pressed', 'true');
    expect(node('user:read')).toHaveAttribute('aria-pressed', 'mixed');
    expect(node('user:read')).toHaveAttribute('data-state', 'implied');

    fireEvent.click(node('user:read'));
    expect(screen.getByTestId('role-permission-notice')).not.toBeEmptyDOMElement();
    expect(node('user:read')).toHaveAttribute('data-state', 'implied');

    // 只送出明確點選的鍵
    fireEvent.click(screen.getByTestId('role-permission-save'));
    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    expect(grant.mock.calls[0]![0]).toMatchObject({
      params: { body: { add: ['user:update'], remove: [] } },
    });
  });

  it('super-admin 角色：全部是已包含、不能變更', async () => {
    fetchRolePermissions.mockResolvedValue({ permissions: [], isSuperAdmin: true });
    renderRoute(routes, PATH, MANAGER);

    await openTree();
    await waitFor(() => expect(node('user:update')).toBeInTheDocument());
    expect(node('user:update')).toBeDisabled();
    expect(node('user:read')).toHaveAttribute('data-state', 'implied');
    expect(screen.getByTestId('role-permission-notice')).not.toBeEmptyDOMElement();
  });
});
