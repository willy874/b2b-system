import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerWorkspaceAdminPagePermissions, Routes } from '../../..';

const { listWorkspaces } = vi.hoisted(() => ({ listWorkspaces: vi.fn() }));
vi.mock('@/apis/workspace/get-workspace-list/query', () => ({
  WORKSPACE_LIST_QUERY_KEY: 'WORKSPACE_LIST_QUERY_KEY',
  getWorkspaceListQueryOptions: () => ({
    queryKey: ['WORKSPACE_LIST_QUERY_KEY'],
    queryFn: listWorkspaces,
  }),
}));

const WORKSPACE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'art',
  name: '美術',
  description: null,
  memberCount: 3,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false, workspaceHydrated: false }
      : { permissions: new Set(permissions), hydrated: true, workspaceHydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.WorkspaceAdminListRoute]),
    history: createMemoryHistory({ initialEntries: ['/workspaces'] }),
    parseSearch,
    stringifySearch,
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerWorkspaceAdminPagePermissions();
  listWorkspaces.mockReset().mockResolvedValue({
    items: [WORKSPACE],
    pagination: { offset: 0, limit: 20, total: 1 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('租戶管理頁（docs/adr/0019-sso-identity-platform.md D13）', () => {
  it('有 workspace:* → 顯示建立、編輯、指定管理員、刪除', async () => {
    renderPage([
      'workspace:read',
      'workspace:create',
      'workspace:update',
      'workspace:delete',
    ] as PermissionKey[]);
    expect(await screen.findByTestId('workspace-edit')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-assign-admin')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-remove')).toBeInTheDocument();
  });

  it('只有 workspace:read → 看得到清單，沒有任何操作按鈕', async () => {
    renderPage(['workspace:read'] as PermissionKey[]);
    expect(await screen.findByTestId('workspace-admin-page')).toBeInTheDocument();
    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    expect(screen.queryByTestId('workspace-create-button')).toBeNull();
    expect(screen.queryByTestId('workspace-edit')).toBeNull();
    expect(screen.queryByTestId('workspace-remove')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('workspace-admin-page')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-create-button')).toBeNull();
  });
});
