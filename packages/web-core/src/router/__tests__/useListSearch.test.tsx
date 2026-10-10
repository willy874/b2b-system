import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { parseSearch, stringifySearch } from '../search';
import { useListSearch } from '../useListSearch';

interface ListQuery {
  offset: number;
  limit: number;
  keyword?: string;
  status?: string;
}

function setup(initial: string) {
  let api: ReturnType<typeof useListSearch<ListQuery>> | undefined;
  const root = createRootRoute({ component: Outlet });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/list',
    validateSearch: (raw: Record<string, unknown>): ListQuery => ({
      offset: Number(raw.offset ?? 0),
      limit: Number(raw.limit ?? 20),
      keyword: raw.keyword as string | undefined,
      status: raw.status as string | undefined,
    }),
    component: function List() {
      api = useListSearch(list);
      return null;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([list]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    parseSearch,
    stringifySearch,
  });
  render(<RouterProvider router={router} />);
  return { router, api: () => api! };
}

describe('useListSearch（列表頁的網址條件）', () => {
  it('換頁只改分頁；改篩選、關鍵字回到第一頁，其他條件照舊', async () => {
    const { api } = setup('/list?offset=40&status=active');
    await waitFor(() => expect(api()).toBeDefined());
    act(() => api().setPage(60, 20));
    await waitFor(() => expect(api().search).toMatchObject({ offset: 60, status: 'active' }));
    act(() => api().setKeyword('al'));
    await waitFor(() =>
      expect(api().search).toMatchObject({ offset: 0, keyword: 'al', status: 'active' }),
    );
    act(() => api().setFilters({ status: 'locked' }));
    await waitFor(() =>
      expect(api().search).toMatchObject({ offset: 0, keyword: 'al', status: 'locked' }),
    );
  });

  it('同一個事件裡連續 patch 兩次：兩次的修改都留著', async () => {
    const { router, api } = setup('/list');
    await waitFor(() => expect(api()).toBeDefined());
    act(() => {
      api().patch({ keyword: 'x' });
      api().patch({ status: 'active' });
    });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ keyword: 'x', status: 'active' }),
    );
  });
});
