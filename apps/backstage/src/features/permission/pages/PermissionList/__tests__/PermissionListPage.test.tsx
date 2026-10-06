import { installFlowDom } from '@b2b-system/ui/testing';
import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerPermissionPagePermissions, Routes } from '../../..';
import permissionZhTW from '../../../locales/zh_TW.json';

const { fetchPermissionList } = vi.hoisted(() => ({ fetchPermissionList: vi.fn() }));
vi.mock('@/apis/permission/get-permission-list/fetcher', () => ({
  fetchPermissionListQuery: fetchPermissionList,
}));

const READER = ['permission:read', 'user:read'] as PermissionKey[];
const routes = [Routes.PermissionListRoute];

const item = (key: string, includes: string[] = [], requires: string[] = []) => ({
  id: key,
  key,
  resource: key.split(':')[0],
  action: key.split(':')[1],
  nameI18nKey: `permission.${key.replace(':', '.')}`,
  description: key === 'user:update' ? '修改使用者的基本資料' : null,
  sortOrder: 0,
  includes,
  requires,
});

/** 技能樹上的一個權限（節點內的按鈕）。 */
const node = (key: string) =>
  screen
    .getAllByTestId('permission-node')
    .find((element) => element.getAttribute('data-value') === key) as HTMLElement;

beforeAll(() => initTestI18n(permissionZhTW));
beforeAll(installFlowDom);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPagePermissionRegistry();
  registerPermissionPagePermissions();
  fetchPermissionList.mockReset().mockResolvedValue({
    items: [
      item('user:read'),
      item('user:update', ['user:read']),
      item('user:delete', ['user:update']),
      item('role:read'),
      item('role:update', ['role:read'], ['user:read']),
    ],
    groups: [
      {
        resource: 'user',
        nameI18nKey: 'permission.resource.user',
        keys: ['user:read', 'user:update', 'user:delete'],
      },
      {
        resource: 'role',
        nameI18nKey: 'permission.resource.role',
        keys: ['role:read', 'role:update'],
      },
    ],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('PermissionListPage', () => {
  it('預設是一覽表：每個資源一組，標出你是否持有', async () => {
    renderRoute(routes, '/permission', READER);

    const groups = await screen.findAllByTestId('permission-group');
    expect(groups.map((group) => group.getAttribute('data-value'))).toEqual(['user', 'role']);
    expect(within(groups[0] as HTMLElement).getAllByText('你持有')).toHaveLength(1);
    expect(screen.queryByTestId('permission-node')).toBeNull();
  });

  it('切換到樹狀圖：網址記住檢視，畫出每個權限的節點', async () => {
    const { router } = renderRoute(routes, '/permission', READER);

    const tab = await screen.findByRole('tab', { name: /樹狀圖/ });
    fireEvent.click(tab);

    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'tree' }));
    await waitFor(() => expect(screen.getAllByTestId('permission-node')).toHaveLength(5));
    expect(node('user:read').getAttribute('data-held')).toBe('true');
    expect(node('user:update').getAttribute('data-held')).toBeNull();
    expect(screen.getByTestId('permission-detail').textContent).toContain('點一個權限查看詳細資訊');
  });

  it('點節點：說明面板顯示說明、包含與被包含的權限，點相關權限跳到那個節點', async () => {
    const { router } = renderRoute(routes, '/permission?view=tree', READER);

    await waitFor(() => expect(node('user:update')).toBeDefined());
    fireEvent.click(node('user:update'));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ view: 'tree', key: 'user:update' }),
    );

    const detail = screen.getByTestId('permission-detail');
    expect(detail.textContent).toContain('user:update');
    expect(detail.textContent).toContain('未持有');
    expect(within(detail).getByTestId('permission-detail-description').textContent).toBe(
      '修改使用者的基本資料',
    );
    const includes = within(detail).getByTestId('permission-detail-includes');
    expect(
      within(includes)
        .getAllByTestId('permission-detail-link')
        .map((link) => link.getAttribute('data-value')),
    ).toEqual(['user:read']);
    const dependents = within(detail).getByTestId('permission-detail-dependents');
    expect(
      within(dependents)
        .getAllByTestId('permission-detail-link')
        .map((link) => link.getAttribute('data-value')),
    ).toEqual(['user:delete']);

    fireEvent.click(within(includes).getByTestId('permission-detail-link'));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ view: 'tree', key: 'user:read' }),
    );
    // user:read 被 user:update（子能力）與 role:update（依賴）帶出
    const readDependents = within(screen.getByTestId('permission-detail')).getByTestId(
      'permission-detail-dependents',
    );
    expect(
      within(readDependents)
        .getAllByTestId('permission-detail-link')
        .map((link) => link.getAttribute('data-value')),
    ).toEqual(['user:update', 'role:update']);
  });

  it('持有它就等於持有：列出遞迴帶來的權限（含跨資源的依賴）', async () => {
    renderRoute(routes, '/permission?view=tree&key=role%3Aupdate', READER);

    const grants = await screen.findByTestId('permission-detail-grants', undefined, {
      timeout: 5000,
    });
    expect(
      within(grants)
        .getAllByTestId('permission-detail-link')
        .map((link) => link.getAttribute('data-value'))
        .toSorted(),
    ).toEqual(['role:read', 'user:read']);
    expect(
      within(screen.getByTestId('permission-detail')).getByTestId('permission-detail-requires')
        .textContent,
    ).toContain('檢視使用者');
  });

  it('從一覽表的「在樹狀圖中查看」跳到該權限', async () => {
    const { router } = renderRoute(routes, '/permission', READER);

    const buttons = await screen.findAllByTestId('permission-show-in-tree');
    fireEvent.click(
      buttons.find((button) => button.getAttribute('data-value') === 'user:delete') as HTMLElement,
    );

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ view: 'tree', key: 'user:delete' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('permission-detail').textContent).toContain('user:delete'),
    );
  });

  it('網址上的鍵不在目錄裡 → 當成沒選', async () => {
    renderRoute(routes, '/permission?view=tree&key=nope%3Aread', READER);

    await waitFor(() => expect(screen.getAllByTestId('permission-node')).toHaveLength(5));
    expect(screen.getByTestId('permission-detail').textContent).toContain('點一個權限查看詳細資訊');
  });

  it('篩選：關鍵字與持有狀態寫進網址，一覽表與樹狀圖都只顯示符合的權限', async () => {
    const { router } = renderRoute(routes, '/permission', READER);

    const keyword = await screen.findByTestId('permission-filter-keyword');
    fireEvent.change(keyword, { target: { value: 'role' } });
    await waitFor(() => expect(router.state.location.search).toEqual({ keyword: 'role' }));
    await waitFor(() =>
      expect(
        screen.getAllByTestId('permission-group').map((group) => group.getAttribute('data-value')),
      ).toEqual(['role']),
    );
    expect(screen.getByTestId('permission-filter-count').textContent).toBe('顯示 2 / 5 項');

    fireEvent.click(screen.getByRole('tab', { name: /樹狀圖/ }));
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('permission-node')
          .map((element) => element.getAttribute('data-value')),
      ).toEqual(['role:read', 'role:update']),
    );

    fireEvent.click(screen.getByTestId('permission-filter-reset'));
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'tree' }));
    await waitFor(() => expect(screen.getAllByTestId('permission-node')).toHaveLength(5));
  });

  it('從網址還原篩選；沒有符合的權限時顯示空狀態', async () => {
    renderRoute(routes, '/permission?resource=user&held=held', READER);

    const groups = await screen.findAllByTestId('permission-group');
    expect(groups).toHaveLength(1);
    expect(within(groups[0] as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
  });

  it('沒有符合篩選條件的權限 → 空狀態', async () => {
    renderRoute(routes, '/permission?keyword=nothing', READER);

    expect(await screen.findByTestId('permission-filter-empty')).toBeDefined();
    expect(screen.queryByTestId('permission-group')).toBeNull();
  });

  it('查詢失敗 → 顯示錯誤與重試，不是一片空白', async () => {
    fetchPermissionList.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/permission', READER);

    expect(await screen.findByTestId('permission-list-error')).toBeInTheDocument();
    expect(screen.getByTestId('query-error-retry')).toBeInTheDocument();
  });
});
