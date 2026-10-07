import { AllProviders } from '@b2b-system/web-core/testing';
import {
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenPage, PageFallback, ROUTER_DEFAULT_COMPONENTS } from '../ErrorPages';

const failure = vi.hoisted(() => ({ error: undefined as Error | undefined }));

function renderAt(url: string) {
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p data-testid="home">home</p>,
  });
  const broken = createRoute({
    getParentRoute: () => root,
    path: '/broken',
    component: () => {
      if (failure.error) throw failure.error;
      return <p data-testid="broken-ok">ok</p>;
    },
  });
  const forbidden = createRoute({
    getParentRoute: () => root,
    path: '/forbidden',
    component: ForbiddenPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, broken, forbidden]),
    history: createMemoryHistory({ initialEntries: [url] }),
    ...ROUTER_DEFAULT_COMPONENTS,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

beforeEach(() => {
  failure.error = undefined;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  // 渲染錯誤時 React 會把錯誤印到 console.error；這裡是預期的
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 錯誤頁本身（含 isChunkLoadError）的行為在 web-core 的 ErrorPage.test.tsx；這裡驗 apps/platform 的接法
describe('router 的預設 404 與錯誤頁', () => {
  it('未知網址 → 本地化的 404（compact 版面），可以回首頁', async () => {
    const router = renderAt('/not-exist');
    expect(await screen.findByTestId('not-found-page')).toHaveAttribute('data-variant', 'compact');
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

  it('chunk 載入失敗 → 提示系統已更新並提供重新整理', async () => {
    failure.error = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderAt('/broken');
    expect(await screen.findByTestId('app-updated-page')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('error-page-reload'));
    expect(reload).toHaveBeenCalled();
  });

  it('其他錯誤 → 通用錯誤頁，不顯示技術訊息；重試會重畫', async () => {
    failure.error = new Error('secret stack detail');
    renderAt('/broken');
    const page = await screen.findByTestId('unexpected-error-page');
    expect(page).not.toHaveTextContent('secret stack detail');

    failure.error = undefined;
    fireEvent.click(screen.getByTestId('error-page-retry'));
    expect(await screen.findByTestId('broken-ok')).toBeInTheDocument();
  });

  it('403 頁有「回首頁」與「返回上一頁」', async () => {
    renderAt('/forbidden');
    expect(await screen.findByTestId('forbidden-page')).toBeInTheDocument();
    expect(screen.getByTestId('error-page-back')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('error-page-home'));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
  });
});

describe('PageFallback（apps/platform 的載入中）', () => {
  it('有 spinner 的視覺回饋，不是空白', () => {
    render(<PageFallback />);
    const fallback = screen.getByTestId('page-fallback');
    expect(fallback).toHaveAttribute('aria-busy', 'true');
    expect(fallback.querySelector('output')).not.toBeNull();
  });
});
