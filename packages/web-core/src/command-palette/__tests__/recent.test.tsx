import { createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerNavItem, resetNavigationRegistry } from '../../navigation';
import {
  definePageKey,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '../../permission';
import { RootRoute } from '../../router';
import { renderRoute } from '../../testing/renderRoute';
import { RECENT_PAGE_LIMIT, useRecentPageStore } from '../recent';
import { matchesQuery } from '../usePaletteSections';
import { useRecentPageTracker } from '../useRecentPageTracker';

const page = (key: string) => definePageKey(key);

beforeEach(() => {
  useRecentPageStore.setState({ pages: [] });
  resetPagePermissionRegistry();
  resetNavigationRegistry();
});

describe('最近造訪', () => {
  it('最近的在前、不重複、最多 RECENT_PAGE_LIMIT 頁', () => {
    const { record } = useRecentPageStore.getState();
    for (const key of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) record(page(key));
    const pages = useRecentPageStore.getState().pages;
    expect(pages).toEqual(['f', 'e', 'd', 'a', 'c']);
    expect(pages).toHaveLength(RECENT_PAGE_LIMIT);
  });

  it('換頁時記下有選單入口的頁面，子路徑算在它的頁面底下；沒有入口的頁面不記', async () => {
    const USER = page('user');
    const SECRET = page('secret');
    registerPagePermission(USER, { route: '/user', rule: { access: [], match: 'every' } });
    registerPagePermission(SECRET, { route: '/secret', rule: { access: [], match: 'every' } });
    registerNavItem({
      pageKey: USER,
      to: '/user',
      labelKey: 'menu.user',
      testId: 'menu-user',
      icon: 'users',
      order: 100,
    });
    function Tracker() {
      useRecentPageTracker();
      return <p data-testid="tracked" />;
    }
    const routes = ['/user/$userId', '/secret'].map((path) =>
      createRoute({ getParentRoute: () => RootRoute, path, component: Tracker }),
    );
    const { router } = renderRoute(routes, '/user/u1', []);
    expect(await screen.findByTestId('tracked')).toBeInTheDocument();
    await waitFor(() => expect(useRecentPageStore.getState().pages).toEqual([USER]));

    await router.navigate({ to: '/secret' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/secret'));
    expect(useRecentPageStore.getState().pages).toEqual([USER]);
  });
});

describe('matchesQuery', () => {
  it.each([
    ['使用者設定', '', true],
    ['使用者設定', '使用', true],
    ['使用者設定', '使用 設定', true],
    ['Audit Log', 'audit', true],
    ['Audit Log', 'log  AUD', true],
    ['使用者', '角色', false],
  ])('%s ← %s：%s', (text, query, expected) => {
    expect(matchesQuery(text, query)).toBe(expected);
  });
});
