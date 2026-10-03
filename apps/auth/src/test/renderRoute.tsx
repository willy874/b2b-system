import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import type { PermissionKey } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';

import { AllProviders } from './renderWithPermissions';

/**
 * 以記憶體路由渲染 feature 的 route 樹（頁面整合測試用）。
 * `permissions` 傳 `'unhydrated'` 模擬權限尚未水合的第三態。
 */
export function renderRoute(
  routes: AnyRoute[],
  initialPath: string,
  permissions: PermissionKey[] | 'unhydrated',
): RenderResult & { router: AnyRouter } {
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
  const result = render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return { ...result, router };
}
