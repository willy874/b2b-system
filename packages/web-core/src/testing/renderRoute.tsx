import type { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import type { PermissionKey } from '../permission';
import { parseSearch, RootRoute, stringifySearch } from '../router';
import { usePermissionStore } from '../store';
import { AllProviders, createTestQueryClient } from './renderWithPermissions';

/**
 * 以記憶體路由渲染 feature 的 route 樹（頁面整合測試用）。
 * `permissions` 傳 `'unhydrated'` 模擬權限尚未水合的第三態。
 * 回傳的 `queryClient` 是頁面用的那一個：以 `setQueryData` 模擬推播或重抓帶來的新資料。
 */
export function renderRoute(
  routes: AnyRoute[],
  initialPath: string,
  permissions: PermissionKey[] | 'unhydrated',
): RenderResult & { router: AnyRouter; queryClient: QueryClient } {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    parseSearch,
    stringifySearch,
  });
  const queryClient = createTestQueryClient();
  const result = render(
    <AllProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return { ...result, router, queryClient };
}
