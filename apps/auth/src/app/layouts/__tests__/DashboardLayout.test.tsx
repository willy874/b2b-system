import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { useLayoutStore, usePermissionStore } from '@/core/store';
import { registerAccountPagePermissions } from '@/features/account';
import { registerAuditLogPagePermissions } from '@/features/audit-log';
import { registerTenantPagePermissions } from '@/features/tenant';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { DashboardLayout } from '../DashboardLayout';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));

function renderShell() {
  const root = createRootRoute({
    component: () => (
      <DashboardLayout>
        <p>page</p>
      </DashboardLayout>
    ),
  });
  const routes = ['/', '/tenant', '/audit-log', '/profile', '/preference', '/enter'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
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

beforeAll(() => initTestI18n());

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAccountPagePermissions();
  registerTenantPagePermissions();
  registerAuditLogPagePermissions();
  usePermissionStore.setState({
    permissions: new Set([PermissionKey['tenant:read']]),
    hydrated: true,
  });
  useLayoutStore.setState({ sidebarCollapsed: false });
  fetchProfile.mockReset().mockResolvedValue({
    admin: { id: 'me', displayName: 'Mei Lin', role: 'operator' },
    permissions: ['tenant:read'],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardLayout（平台）', () => {
  it('品牌下方標示平台，而不是租戶；帳號選單以管理者名稱命名', async () => {
    renderShell();
    expect(await screen.findByTestId('current-realm')).toHaveTextContent('帳號平台');
    expect(await screen.findByRole('button', { name: '帳號選單（Mei Lin）' })).toBeInTheDocument();
  });

  it('側欄依頁面權限分組：沒有權限的頁面與整個空的分類都不出現', async () => {
    renderShell();
    expect(await screen.findByTestId('menu-group-tenant')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-audit-log')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-group-system')).not.toBeInTheDocument();
  });

  it('帳號選單有個人資料、偏好設定、進入租戶與登出', async () => {
    const router = renderShell();
    fireEvent.click(await screen.findByTestId('account-menu-trigger'));
    for (const name of ['個人資料', '偏好設定', '進入租戶', '登出']) {
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('menuitem', { name: '進入租戶' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/enter'));
  });

  it('側欄開關的名稱是語系文字，並以 aria-expanded 表示狀態', async () => {
    renderShell();
    const toggle = await screen.findByRole('button', { name: '側邊選單' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('窄螢幕：側欄預設收起，開關打開抽屜，換頁後自動收起', async () => {
    emulateNarrow(true);
    const router = renderShell();
    const toggle = await screen.findByRole('button', { name: '側邊選單' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('sidebar-scrim')).toBeInTheDocument();

    await router.navigate({ to: '/profile' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByTestId('sidebar-scrim')).not.toBeInTheDocument();
    // 窄螢幕不動桌面的「收合成圖示欄」偏好
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
  });
});
