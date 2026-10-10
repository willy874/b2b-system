import { RootRoute } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { createRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';
import { registerSystemSettingsTab, resetSystemSettingsTabs } from '@/core/system-settings';
import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';

const GENERAL = definePageKey('TEST_SYSTEM_INDEX_GENERAL');
const SECURITY = definePageKey('TEST_SYSTEM_INDEX_SECURITY');

/** 分頁的目的地：這裡只確認導向，不渲染真的分頁。 */
const GeneralTabRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/general',
  component: () => <p data-testid="system-tab-general-stub" />,
});
const SecurityTabRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/security',
  component: () => <p data-testid="system-tab-security-stub" />,
});
const routes = [Routes.SystemRoute, GeneralTabRoute, SecurityTabRoute];

beforeAll(() => initTestI18n());

beforeEach(() => {
  resetPagePermissionRegistry();
  resetSystemSettingsTabs();
  registerPagePermission(GENERAL, {
    route: '/system/general',
    rule: { access: ['system:read' as PermissionKey], match: PermissionMatch.EVERY },
  });
  registerPagePermission(SECURITY, {
    route: '/system/security',
    rule: { access: ['mfaPolicy:read' as PermissionKey], match: PermissionMatch.EVERY },
  });
  registerSystemSettingsTab({
    key: 'security',
    pageKey: SECURITY,
    to: '/system/security',
    labelKey: 'menu.security',
    order: 200,
  });
  registerSystemSettingsTab({
    key: 'general',
    pageKey: GENERAL,
    to: '/system/general',
    labelKey: 'menu.settingGeneral',
    order: 100,
  });
  featureStore.setState({ resolved: true, statuses: new Map() });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  resetFeatureStore();
  vi.restoreAllMocks();
});

/** 頁面（lazy）已經渲染出來，且停在骨架屏：沒有空狀態、還在 `/system`。 */
async function expectSkeleton(router: { state: { location: { pathname: string } } }) {
  const layout = await screen.findByTestId('system-settings-layout', undefined, { timeout: 5000 });
  expect(layout.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  expect(screen.queryByTestId('system-settings-empty')).toBeNull();
  expect(router.state.location.pathname).toBe('/system');
}

describe('SystemIndexPage（docs/architecture/frontend/02-plugin-system.md §4.5）', () => {
  it('權限未水合 → 顯示骨架、不導向；水合後導向第一個看得到的分頁', async () => {
    const { router } = renderRoute(routes, '/system', 'unhydrated');
    await expectSkeleton(router);

    act(() => {
      usePermissionStore.setState({
        permissions: new Set(['system:read', 'mfaPolicy:read'] as PermissionKey[]),
        hydrated: true,
      });
    });
    expect(await screen.findByTestId('system-tab-general-stub')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system/general');
  });

  it('feature 清單還沒到 → 顯示骨架、不導向（避免「一般」分頁還沒安裝時先被導到第二個分頁）', async () => {
    featureStore.setState({ resolved: false });
    const { router } = renderRoute(routes, '/system', ['mfaPolicy:read'] as PermissionKey[]);
    await expectSkeleton(router);
    // 等一下：feature 清單沒到之前不會自己導向
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe('/system');

    act(() => {
      usePermissionStore.setState({
        permissions: new Set(['system:read', 'mfaPolicy:read'] as PermissionKey[]),
        hydrated: true,
      });
      featureStore.setState({ resolved: true });
    });
    expect(await screen.findByTestId('system-tab-general-stub')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system/general');
  });

  it('都到齊 → 以 replace 導向第一個看得到的分頁（上一頁不會回到 /system）', async () => {
    const { router } = renderRoute(routes, '/system', ['mfaPolicy:read'] as PermissionKey[]);
    expect(
      await screen.findByTestId('system-tab-security-stub', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system/security');
    expect(router.history.length).toBe(1);
  });

  it('沒有任何看得到的分頁 → 顯示空狀態、不導向', async () => {
    const { router } = renderRoute(routes, '/system', ['user:read'] as PermissionKey[]);
    expect(
      await screen.findByTestId('system-settings-empty', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/system'));
  });
});
