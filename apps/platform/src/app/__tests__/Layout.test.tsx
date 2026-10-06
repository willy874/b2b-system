import type * as Auth from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { Layout } from '../Layout';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@b2b-system/web-core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof Auth>()),
  useHasSession: () => true,
}));

// 不套平台外框（/setup 底下是置中的頁面），只測守衛本身
const SECRET_PATH = '/setup/secret';

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
    rule: { access: [PermissionKey['tenant:read']], match: PermissionMatch.EVERY },
  });
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });
  fetchProfile.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('Layout：權限水合失敗（與 apps/backstage 相同）', () => {
  it('profile 回 500 → 顯示錯誤頁與重試，不一直轉圈；重試成功後進入頁面', async () => {
    fetchProfile.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderLayout();

    expect(await screen.findByTestId('unexpected-error-page')).toBeInTheDocument();
    expect(screen.queryByTestId('page-fallback')).not.toBeInTheDocument();

    // 水合由 useSyncPermissions（App 的 SessionWatcher）負責，這裡模擬它收到資料後寫入 store
    fetchProfile.mockImplementation(async () => {
      usePermissionStore.getState().setPermissions([PermissionKey['tenant:read']]);
      return { admin: { id: 'me' }, permissions: ['tenant:read'] };
    });
    fireEvent.click(screen.getByTestId('error-page-retry'));
    expect(await screen.findByText('secret content')).toBeInTheDocument();
  });

  it('profile 還在載入 → 轉圈', async () => {
    fetchProfile.mockReturnValue(new Promise(() => undefined));
    renderLayout();

    expect(await screen.findByTestId('page-fallback')).toBeInTheDocument();
  });
});
