import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import {
  ErrorPage,
  ForbiddenPage,
  isChunkLoadError,
  NotFoundPage,
  RouteErrorPage,
  UnexpectedErrorPage,
} from './ErrorPage';

const failure = vi.hoisted(() => ({ error: undefined as Error | undefined }));

function renderAt(url: string) {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p data-testid="home">home</p>,
  });
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
    component: () => <ForbiddenPage />,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, broken, forbidden]),
    history: createMemoryHistory({ initialEntries: [url] }),
    defaultNotFoundComponent: () => <NotFoundPage />,
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
  // router 捕捉到的錯誤會印到 console；這裡是預期的
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isChunkLoadError（部署新版後舊 chunk 不見）', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.com/assets/Page-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Page-abc.css',
  ])('「%s」是 chunk 載入失敗', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('name 是 ChunkLoadError 也算', () => {
    const error = new Error('whatever');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('其他錯誤、不是 Error 的值都不算', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});

describe('router 的預設 404／錯誤頁', () => {
  it('未知網址顯示本地化的 404，可以回首頁', async () => {
    const router = renderAt('/not-exist');
    expect(await screen.findByTestId('not-found-page')).toHaveTextContent('找不到頁面');
    fireEvent.click(screen.getByTestId('error-page-home'));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('404 的「返回上一頁」回到前一個網址', async () => {
    const router = renderAt('/');
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    await router.navigate({ to: '/nope' as '/' });
    fireEvent.click(await screen.findByTestId('error-page-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('部署後舊 chunk 載入失敗：提示系統已更新，按鈕重新整理頁面', async () => {
    failure.error = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderAt('/broken');
    expect(await screen.findByTestId('app-updated-page')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('error-page-reload'));
    expect(reload).toHaveBeenCalled();
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
    expect(screen.getByTestId('error-page-back')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('error-page-home'));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
  });
});

describe('UnexpectedErrorPage（頁面需要的資料拿不到）', () => {
  it('有錯誤時顯示錯誤的本地化說明；有 onRetry 才有重試', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AllProviders>
        <UnexpectedErrorPage error={new Error('x')} onRetry={onRetry} />
      </AllProviders>,
    );
    fireEvent.click(screen.getByTestId('error-page-retry'));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <AllProviders>
        <UnexpectedErrorPage />
      </AllProviders>,
    );
    expect(screen.getByTestId('unexpected-error-page')).toHaveTextContent(
      '請重試，或聯絡系統管理員',
    );
    expect(screen.queryByTestId('error-page-retry')).not.toBeInTheDocument();
  });
});

describe('ErrorPage（版面）', () => {
  it('預設 centered；variant 以 data-variant 表達', () => {
    const { rerender } = render(<ErrorPage title="t" data-testid="page" />);
    expect(screen.getByTestId('page')).toHaveAttribute('data-variant', 'centered');
    rerender(<ErrorPage variant="compact" title="t" data-testid="page" />);
    expect(screen.getByTestId('page')).toHaveAttribute('data-variant', 'compact');
  });

  it('沒有說明與動作時不渲染空的區塊', () => {
    render(<ErrorPage code="404" title="標題" data-testid="page" />);
    const page = screen.getByTestId('page');
    expect(page.children).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 1, name: '標題' })).toBeInTheDocument();
  });
});
