import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { i18n, initI18n } from '../../locales';
import { DocumentTitle } from '../DocumentTitle';

const RESOURCES = {
  'zh-TW': { app: { title: '產品' }, page: { users: '使用者', roles: '角色' } },
  'en-US': { app: { title: 'Product' }, page: { users: 'Users', roles: 'Roles' } },
};

function createTestRouter(path: string) {
  const root = createRootRoute({ component: Outlet });
  const users = createRoute({
    getParentRoute: () => root,
    path: '/users',
    staticData: { titleKey: 'page.users' },
  });
  // 子路由（對話框）沒有自己的標題：沿用上層
  const userDetail = createRoute({ getParentRoute: () => users, path: '$id' });
  const roles = createRoute({
    getParentRoute: () => root,
    path: '/roles',
    staticData: { titleKey: 'page.roles' },
  });
  const untitled = createRoute({ getParentRoute: () => root, path: '/untitled' });
  const missing = createRoute({
    getParentRoute: () => root,
    path: '/missing',
    staticData: { titleKey: 'page.notLoaded' },
  });
  return createRouter({
    routeTree: root.addChildren([users.addChildren([userDetail]), roles, untitled, missing]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

async function renderAt(path: string) {
  const router = createTestRouter(path);
  await router.load();
  render(<DocumentTitle router={router} appNameKey="app.title" />);
  return router;
}

describe('DocumentTitle（docs/architecture/frontend/08-i18n.md §5）', () => {
  beforeAll(async () => {
    await initI18n('zh-TW');
    for (const [language, resources] of Object.entries(RESOURCES)) {
      i18n.addResourceBundle(language, 'translation', resources, true, true);
    }
  });

  afterEach(async () => {
    await act(() => i18n.changeLanguage('zh-TW'));
  });

  it('「頁面 · 產品名」；子路由沿用最近的上層標題', async () => {
    await renderAt('/users/42');
    await waitFor(() => expect(document.title).toBe('使用者 · 產品'));
  });

  it('換頁時跟著換', async () => {
    const router = await renderAt('/users');
    await waitFor(() => expect(document.title).toBe('使用者 · 產品'));
    await act(() => router.navigate({ to: '/roles' }));
    await waitFor(() => expect(document.title).toBe('角色 · 產品'));
  });

  it('換語系時跟著換', async () => {
    await renderAt('/roles');
    await act(() => i18n.changeLanguage('en-US'));
    await waitFor(() => expect(document.title).toBe('Roles · Product'));
  });

  it('沒有標題、或標題的語系包還沒載入 → 只顯示產品名，不顯示原始 key', async () => {
    await renderAt('/untitled');
    await waitFor(() => expect(document.title).toBe('產品'));
    document.title = '';
    await renderAt('/missing');
    await waitFor(() => expect(document.title).toBe('產品'));
  });
});
