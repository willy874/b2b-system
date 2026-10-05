import { AllProviders } from '@b2b-system/web-core/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { ForbiddenPage, isChunkLoadError, NotFoundPage, RouteErrorPage } from '../ErrorPage';

const failure = vi.hoisted(() => ({ error: undefined as Error | undefined }));

function renderAt(url: string) {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>home</p> });
  const broken = createRoute({
    getParentRoute: () => root,
    path: '/broken',
    loader: () => {
      if (failure.error) throw failure.error;
    },
    component: () => <p>broken page</p>,
  });
  const forbidden = createRoute({
    getParentRoute: () => root,
    path: '/forbidden',
    component: ForbiddenPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, broken, forbidden]),
    history: createMemoryHistory({ initialEntries: [url] }),
    // 與 app/plugin.ts 相同的設定
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

beforeAll(() => initTestI18n());
beforeEach(() => {
  failure.error = undefined;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('router 的預設 404／錯誤頁', () => {
  it('未知網址顯示本地化的 404，可以回首頁', async () => {
    const router = renderAt('/not-exist');
    expect(await screen.findByTestId('not-found-page')).toHaveTextContent('找不到頁面');
    fireEvent.click(screen.getByTestId('error-page-home'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('部署後舊 chunk 載入失敗：提示系統已更新並提供重新整理', async () => {
    failure.error = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
    renderAt('/broken');
    expect(await screen.findByTestId('app-updated-page')).toBeInTheDocument();
    expect(screen.getByTestId('error-page-reload')).toBeInTheDocument();
  });

  it('其他錯誤不顯示技術訊息，可以重試', async () => {
    failure.error = new Error('boom: stack trace');
    renderAt('/broken');
    const page = await screen.findByTestId('unexpected-error-page');
    expect(page).not.toHaveTextContent('boom');

    failure.error = undefined;
    fireEvent.click(screen.getByTestId('error-page-retry'));
    expect(await screen.findByText('broken page')).toBeInTheDocument();
  });

  it('403 頁有回首頁與返回上一頁', async () => {
    renderAt('/forbidden');
    expect(await screen.findByTestId('forbidden-page')).toBeInTheDocument();
    expect(screen.getByTestId('error-page-home')).toBeInTheDocument();
    expect(screen.getByTestId('error-page-back')).toBeInTheDocument();
  });
});

describe('isChunkLoadError', () => {
  it.each([
    ['Failed to fetch dynamically imported module: x', true],
    ['error loading dynamically imported module', true],
    ['Importing a module script failed.', true],
    ['Unable to preload CSS for /assets/a.css', true],
    ['Cannot read properties of undefined', false],
  ])('%s → %s', (message, expected) => {
    expect(isChunkLoadError(new Error(message))).toBe(expected);
  });
});
