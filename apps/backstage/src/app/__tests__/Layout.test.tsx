import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Auth from '@/core/auth';
import { AppError } from '@/core/errors';
import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';
import { usePermissionStore } from '@/core/store';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { Layout } from '../Layout';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof Auth>()),
  useHasSession: () => true,
}));

// 不套 DashboardLayout（/auth 底下不套外框），只測守衛本身
const SECRET_PATH = '/auth/secret';

function renderLayout() {
  const root = createRootRoute({ component: Layout });
  const secret = createRoute({
    getParentRoute: () => root,
    path: SECRET_PATH,
    component: () => <p>secret content</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([secret]),
    history: createMemoryHistory({ initialEntries: [SECRET_PATH] }),
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  resetPagePermissionRegistry();
  registerPagePermission(definePageKey('SECRET'), {
    route: SECRET_PATH,
    rule: { access: [PermissionKey['user:read']], match: PermissionMatch.EVERY },
  });
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });
  fetchProfile.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('Layout：權限水合失敗（docs/issues/04-user-experience.md UX-08）', () => {
  it('profile 回 503 → 顯示原因與重試，不停在骨架屏；重試成功後進入頁面', async () => {
    fetchProfile.mockRejectedValue(new AppError('TENANT_UNAVAILABLE', 503));
    renderLayout();

    const page = await screen.findByTestId('unexpected-error-page');
    expect(page).toHaveTextContent('這個租戶目前無法使用');
    expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();

    fetchProfile.mockResolvedValue({ user: { id: 'me' }, permissions: ['user:read'] });
    // 水合由 useSyncPermissions（App 的 SessionWatcher）負責，這裡模擬它收到資料後寫入 store
    fetchProfile.mockImplementation(async () => {
      usePermissionStore.getState().setPermissions([PermissionKey['user:read']]);
      return { user: { id: 'me' }, permissions: ['user:read'] };
    });
    fireEvent.click(screen.getByTestId('error-page-retry'));
    expect(await screen.findByText('secret content')).toBeInTheDocument();
  });

  it('profile 還在載入 → 骨架屏', async () => {
    fetchProfile.mockReturnValue(new Promise(() => undefined));
    renderLayout();

    expect(await screen.findByTestId('page-skeleton')).toBeInTheDocument();
  });
});
