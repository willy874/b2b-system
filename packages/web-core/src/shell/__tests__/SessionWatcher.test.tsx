import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../../auth';
import { queryClient } from '../../cache';
import {
  parseSearch,
  stringifySearch,
  useDialogUnsavedGuard,
  useUnsavedChangesGuard,
} from '../../router';
import { useTableColumnSettingsStore, usePermissionStore } from '../../store';
import { AllProviders, initTestI18n } from '../../testing';
import { SessionWatcher } from '../SessionWatcher';

const LOGIN_PATH = '/login';
const isPublic = (pathname: string) => pathname === LOGIN_PATH;

/** 表單一直是 dirty 的頁面：任何離開的導覽都會先問「要放棄變更嗎？」。 */
function DirtyForm() {
  useUnsavedChangesGuard(true);
  return <p data-testid="dirty-form">editing</p>;
}

/** 以 state 開關的對話框開著且 dirty（useDialogUnsavedGuard 也掛了 blocker）。 */
function DirtyDialog() {
  useDialogUnsavedGuard(true, () => undefined);
  return <p data-testid="dirty-dialog">editing</p>;
}

function renderApp(initialPath: string): AnyRouter {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/form', component: DirtyForm }),
      createRoute({ getParentRoute: () => root, path: '/dialog', component: DirtyDialog }),
      createRoute({
        getParentRoute: () => root,
        path: LOGIN_PATH,
        component: () => <p data-testid="login-page">login</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <SessionWatcher router={router} loginPath={LOGIN_PATH} isPublic={isPublic} />
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  // 每個案例都從「已登入」開始：新的 token 也會解除上一個案例結束 session 的 latch
  sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
});

afterEach(() => {
  sessionStore.clear();
  vi.restoreAllMocks();
});

describe('SessionWatcher：session 中途結束（docs/architecture/frontend/04-routing.md §2.1、§4.3）', () => {
  it.each([
    ['/form', 'dirty-form'],
    ['/dialog', 'dirty-dialog'],
  ])('%s 有未儲存的變更：直接導到登入頁，不跳出「要放棄變更嗎？」', async (path, testId) => {
    const router = renderApp(path);
    await screen.findByTestId(testId);

    act(() => sessionStore.endSession('password_changed'));

    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
    expect(router.state.location.search).toEqual({
      signedOut: 'true',
      reason: 'password_changed',
      redirect: path,
    });
    expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument();
  });

  it('清掉以使用者身分取得的資料：權限集合、查詢快取、表格釘選列的資料', async () => {
    usePermissionStore.getState().setPermissions(['user:read']);
    queryClient.setQueryData(['profile'], { id: 'me' });
    useTableColumnSettingsStore
      .getState()
      .pinRow('user-list', '1', 'top', { email: 'a@acme.test' });
    renderApp('/form');
    await screen.findByTestId('dirty-form');

    act(() => sessionStore.endSession('logout'));

    await screen.findByTestId('login-page');
    expect(usePermissionStore.getState()).toMatchObject({ hydrated: false });
    expect(usePermissionStore.getState().permissions.size).toBe(0);
    expect(queryClient.getQueryData(['profile'])).toBeUndefined();
    expect(useTableColumnSettingsStore.getState().pinnedRowData).toEqual({});
  });
});

describe('SessionWatcher：完全沒有 session', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('受保護的頁面 → 導到登入頁並記住原本的網址（含查詢字串）', async () => {
    const router = renderApp('/dialog?keyword=a');

    await screen.findByTestId('login-page');
    expect(router.state.location.search).toEqual({ redirect: '/dialog?keyword=a' });
  });

  it('公開的頁面 → 留在原地', async () => {
    const router = renderApp(LOGIN_PATH);

    await screen.findByTestId('login-page');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});
