import { createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RootRoute } from '@/core/router';
import { renderRoute } from '@/test/renderRoute';

import { registerRouteLink, resetRouteLinkRegistry } from '../registry';
import { RouteLink } from '../RouteLink';

const userList = createRoute({ getParentRoute: () => RootRoute, path: '/user' });
const userDetail = createRoute({ getParentRoute: () => userList, path: '$userId' });
const page = createRoute({
  getParentRoute: () => RootRoute,
  path: '/page',
  component: () => (
    <RouteLink to="user.detail" params={{ userId: 'u1' }} data-testid="link">
      Alice
    </RouteLink>
  ),
});
const routes = [page, userList.addChildren([userDetail])];

describe('RouteLink', () => {
  beforeEach(() => resetRouteLinkRegistry());

  it('route id 已登記：渲染成連到目標頁的連結', async () => {
    registerRouteLink('user.detail', { route: userDetail, params: { userId: 'userId' } });
    renderRoute(routes, '/page', []);
    const link = await screen.findByTestId('link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/user/u1');
  });

  it('route id 沒有登記（目標 feature 沒安裝）：只渲染文字，屬性照樣套用', async () => {
    renderRoute(routes, '/page', []);
    const text = await screen.findByTestId('link');
    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveTextContent('Alice');
  });
});
