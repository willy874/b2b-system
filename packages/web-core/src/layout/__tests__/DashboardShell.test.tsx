import { createRoute } from '@tanstack/react-router';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerNavGroup, registerNavItem, resetNavigationRegistry } from '../../navigation';
import {
  definePageKey,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '../../permission';
import { RootRoute } from '../../router';
import { useLayoutStore } from '../../store';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { DashboardShell } from '../DashboardShell';
import type { DashboardShellProps } from '../DashboardShell';

const PROFILE = definePageKey('profile');
const USER = definePageKey('user');

const LABELS = {
  menu: { profile: '個人資料', logout: '登出', user: '使用者', group: { people: '人員管理' } },
};

const onLogout = vi.fn();

function renderShell(overrides: Partial<DashboardShellProps> = {}) {
  const shell = () => (
    <DashboardShell
      brand={{
        mark: 'B2B',
        name: 'B2B System',
        context: { label: 'Acme', testId: 'current-tenant' },
      }}
      userName="Mei Lin"
      accountActions={[{ key: 'logout', label: '登出', tone: 'danger', onSelect: onLogout }]}
      afterContent={<p data-testid="after-content" />}
      {...overrides}
    >
      <p data-testid="page">page</p>
    </DashboardShell>
  );
  const routes = ['/', '/profile', '/user'].map((path) =>
    createRoute({ getParentRoute: () => RootRoute, path, component: shell }),
  );
  return renderRoute(routes, '/', []);
}

/** jsdom 沒有 matchMedia：模擬窄螢幕。 */
function emulateNarrow(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

let unregister: Array<() => void> = [];

beforeAll(() => initTestI18n(LABELS));
beforeEach(() => {
  resetPagePermissionRegistry();
  resetNavigationRegistry();
  unregister = [
    registerPagePermission(PROFILE, { route: '/profile', rule: { access: [], match: 'every' } }),
    registerPagePermission(USER, { route: '/user', rule: { access: [], match: 'every' } }),
    registerNavGroup({
      key: 'people',
      labelKey: 'menu.group.people',
      testId: 'menu-group-people',
      order: 100,
    }),
    registerNavItem({
      pageKey: USER,
      to: '/user',
      labelKey: 'menu.user',
      testId: 'menu-user',
      icon: 'users',
      group: 'people',
      order: 100,
    }),
    registerNavItem({
      pageKey: PROFILE,
      to: '/profile',
      labelKey: 'menu.profile',
      testId: 'menu-profile',
      icon: 'user',
      placement: 'account',
      order: 100,
    }),
  ];
  onLogout.mockReset();
  useLayoutStore.setState({ sidebarCollapsed: false });
});
afterEach(() => {
  for (const dispose of unregister) dispose();
  vi.unstubAllGlobals();
});

describe('DashboardShell（登入後的外框）', () => {
  it('品牌：徽章、產品名與下方的一行；主內容與 afterContent 都渲染', async () => {
    renderShell();
    expect(await screen.findByTestId('brand-mark')).toHaveTextContent('B2B');
    expect(screen.getByText('B2B System')).toBeInTheDocument();
    expect(screen.getByTestId('current-tenant')).toHaveTextContent('Acme');
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.getByTestId('after-content')).toBeInTheDocument();
  });

  it('收合成圖示欄：產品名收起，品牌下方那一行改放在 title', async () => {
    useLayoutStore.setState({ sidebarCollapsed: true });
    renderShell();
    const mark = await screen.findByTestId('brand-mark');
    expect(screen.queryByText('B2B System')).not.toBeInTheDocument();
    expect(mark.parentElement).toHaveAttribute('title', 'Acme');
  });

  it('沒有品牌下方那一行時不渲染空元素', async () => {
    renderShell({ brand: { mark: 'B2B', name: 'B2B System' } });
    expect(await screen.findByText('B2B System')).toBeInTheDocument();
    expect(screen.queryByTestId('current-tenant')).not.toBeInTheDocument();
  });

  it('帳號選單：先列有權限的頁面（選了換頁），再接 app 傳入的項目', async () => {
    const { router } = renderShell();
    fireEvent.click(await screen.findByRole('button', { name: '帳號選單（Mei Lin）' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['個人資料', '登出']);

    fireEvent.click(screen.getByRole('menuitem', { name: '登出' }));
    expect(onLogout).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '個人資料' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });

  it('側欄的分類與頁面來自選單註冊表；帳號選單的頁面不出現在側欄', async () => {
    renderShell();
    expect(await screen.findByTestId('menu-group-people')).toHaveTextContent('人員管理');
    expect(screen.getByTestId('menu-user')).toHaveAttribute('href', '/user');
    expect(screen.queryByTestId('menu-profile')).not.toBeInTheDocument();
  });

  it('feature 卸載（反註冊）時入口跟著從側欄消失', async () => {
    renderShell();
    expect(await screen.findByTestId('menu-user')).toBeInTheDocument();
    act(() => unregister[3]?.());
    expect(screen.queryByTestId('menu-user')).not.toBeInTheDocument();
  });

  it('桌面：側欄開關切換「收合成圖示欄」的偏好', async () => {
    renderShell();
    const toggle = await screen.findByTestId('sidebar-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
  });

  it('窄螢幕：開關打開抽屜，點遮罩收起，不動桌面的偏好', async () => {
    emulateNarrow(true);
    renderShell();
    const toggle = await screen.findByTestId('sidebar-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('sidebar-scrim'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
  });
});
