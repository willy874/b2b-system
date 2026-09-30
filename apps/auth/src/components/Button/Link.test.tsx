import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonLink } from './index';

/** 在只有兩頁（`/`、`/login`）的 memory router 裡渲染 `ui`。 */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>個人資料</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('link');
  return router;
}

describe('ButtonLink（按鈕外觀的導頁連結）', () => {
  beforeEach(() => {
    // router 換頁後會捲回頂端；jsdom 沒有實作 scrollTo
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  it('渲染成帶 href 的 <a>，外觀用 data-* 表達', async () => {
    await renderInRouter(
      <ButtonLink to="/login" variant="primary" size="sm">
        管理
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: '管理' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveAttribute('data-variant', 'primary');
    expect(link).toHaveAttribute('data-size', 'sm');
  });

  it('點擊後導到目標頁', async () => {
    const router = await renderInRouter(<ButtonLink to="/login">管理</ButtonLink>);
    await userEvent.click(screen.getByRole('link', { name: '管理' }));
    expect(await screen.findByText('個人資料')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('disabled 時沒有 href、標記 aria-disabled，點擊不導頁', async () => {
    const router = await renderInRouter(
      <ButtonLink to="/login" disabled>
        管理
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: '管理' });
    expect(link).not.toHaveAttribute('href');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('data-disabled');
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/');
  });

  it('透傳 className 與 data-testid', async () => {
    await renderInRouter(
      <ButtonLink to="/" className="custom" data-testid="my-link">
        首頁
      </ButtonLink>,
    );
    expect(screen.getByTestId('my-link')).toHaveClass('custom');
  });
});
