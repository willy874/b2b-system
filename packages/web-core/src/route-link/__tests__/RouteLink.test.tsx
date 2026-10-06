import { createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '../../permission';
import { RootRoute } from '../../router';
import { renderRoute } from '../../testing/renderRoute';
import { registerRouteLink, resetRouteLinkRegistry } from '../registry';
import { RouteLink } from '../RouteLink';

const userList = createRoute({ getParentRoute: () => RootRoute, path: '/user' });
const userDetail = createRoute({ getParentRoute: () => userList, path: '$userId' });
const page = createRoute({
  getParentRoute: () => RootRoute,
  path: '/page',
  component: () => (
    <>
      <RouteLink to="user.detail" params={{ userId: 'u1' }} data-testid="link">
        Alice
      </RouteLink>
      <RouteLink to="user.detail" params={{ userId: 'u1' }} fallback="hide" data-testid="nav">
        Go
      </RouteLink>
    </>
  ),
});
const routes = [page, userList.addChildren([userDetail])];

function registerUserDetail() {
  registerRouteLink('user.detail', { route: userDetail, params: { userId: 'userId' } });
}

function registerUserPage() {
  registerPagePermission(definePageKey('USER'), {
    route: '/user',
    rule: {
      resource: 'user',
      access: ['user:read'],
      match: PermissionMatch.EVERY,
    },
  });
}

describe('RouteLink（docs/architecture/frontend/03-feature-anatomy.md §4.1）', () => {
  beforeEach(() => {
    resetRouteLinkRegistry();
    resetPagePermissionRegistry();
  });

  it('已登記、目標頁不受權限管制：連到目標頁', async () => {
    registerUserDetail();
    renderRoute(routes, '/page', []);
    const link = await screen.findByTestId('link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/user/u1');
  });

  it('已登記、有目標頁的權限：連到目標頁', async () => {
    registerUserDetail();
    registerUserPage();
    renderRoute(routes, '/page', ['user:read']);
    expect((await screen.findByTestId('link')).tagName).toBe('A');
    expect(screen.getByTestId('nav').tagName).toBe('A');
  });

  it('route id 沒有登記（目標 feature 沒安裝）：只顯示文字，屬性照樣套用；hide 不渲染', async () => {
    renderRoute(routes, '/page', []);
    const text = await screen.findByTestId('link');
    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveTextContent('Alice');
    expect(screen.queryByTestId('nav')).toBeNull();
  });

  it('沒有目標頁的權限：只顯示文字；hide 不渲染', async () => {
    registerUserDetail();
    registerUserPage();
    renderRoute(routes, '/page', []);
    expect((await screen.findByTestId('link')).tagName).toBe('SPAN');
    expect(screen.queryByTestId('nav')).toBeNull();
  });

  it('權限還沒水合：先不可點', async () => {
    registerUserDetail();
    registerUserPage();
    renderRoute(routes, '/page', 'unhydrated');
    expect((await screen.findByTestId('link')).tagName).toBe('SPAN');
    expect(screen.queryByTestId('nav')).toBeNull();
  });
});
