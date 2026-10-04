import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { resetPagePermissionRegistry } from '@/core/permission';
import { useLayoutStore, usePermissionStore } from '@/core/store';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { DashboardLayout } from '../DashboardLayout';

const { fetchProfile, fetchTenant } = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  fetchTenant: vi.fn(),
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/tenant/get-current-tenant/fetcher', () => ({
  fetchCurrentTenantQuery: fetchTenant,
}));

function renderShell() {
  const root = createRootRoute({
    component: () => (
      <DashboardLayout>
        <p>page</p>
      </DashboardLayout>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: '/' });
  const other = createRoute({ getParentRoute: () => root, path: '/user' });
  const router = createRouter({
    routeTree: root.addChildren([home, other]),
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
  usePermissionStore.setState({ permissions: new Set(), hydrated: true });
  useLayoutStore.setState({ sidebarCollapsed: false });
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['tenantSwitch', 'ready']]) });
  fetchProfile.mockReset().mockResolvedValue({
    user: { id: 'me', displayName: 'Mei Lin' },
    permissions: [],
  });
  fetchTenant.mockReset().mockResolvedValue({ code: 'acme', name: 'Acme 股份有限公司' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardLayout', () => {
  it('品牌徽章取自產品名稱，不隨租戶改變', async () => {
    renderShell();
    await screen.findByTestId('current-tenant');
    expect(screen.getByTestId('brand-mark')).toHaveTextContent('B2B');
  });

  it('看得到目前的租戶；帳號選單以使用者名稱命名', async () => {
    renderShell();
    expect(await screen.findByTestId('current-tenant')).toHaveTextContent('Acme 股份有限公司');
    expect(await screen.findByRole('button', { name: '帳號選單（Mei Lin）' })).toBeInTheDocument();
  });

  it('帳號選單有「切換租戶」，前往 apps/platform 的進入租戶頁（租戶啟用了 tenantSwitch）', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderShell();

    fireEvent.click(await screen.findByTestId('account-menu-trigger'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '切換租戶' }));
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/enter$/));
  });

  it('租戶沒有啟用 tenantSwitch → 帳號選單沒有「切換租戶」（docs/architecture/05-tenancy.md §12.2 D6）', async () => {
    featureStore.setState({ statuses: new Map([['tenantSwitch', 'disabled']]) });
    renderShell();

    fireEvent.click(await screen.findByTestId('account-menu-trigger'));
    expect(await screen.findByRole('menuitem', { name: '登出' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '切換租戶' })).not.toBeInTheDocument();
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

    await router.navigate({ to: '/user' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByTestId('sidebar-scrim')).not.toBeInTheDocument();
    // 窄螢幕不動桌面的「收合成圖示欄」偏好
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
  });
});
