import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { getWorkspaceMeQueryOptions } from '@/apis/workspace/get-workspace-me/query';
import { ErrorPage, ForbiddenPage, PageSkeleton } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { usePageAccess } from '@/core/permission';
import type { PermissionKey } from '@/core/permission';
import { usePermissionStore, useWorkspaceStore } from '@/core/store';

import { useMyWorkspaces } from '../../hooks/useMyWorkspaces';
import { WorkspaceRoute } from '../../routes';

/**
 * 工作區的版面（docs/adr/0018-workspace-tenancy.md D17）：網址的 slug → 工作區 → 在這裡的權限，
 * 都準備好才渲染子頁面；子頁面的權限守衛也在這裡（根版面只守平台頁面）。
 * 離開或切換工作區時清掉目前工作區與它的權限。
 */
export function WorkspaceLayout() {
  const { t } = useTranslation();
  const { workspaceSlug } = WorkspaceRoute.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mine = useMyWorkspaces();
  const workspace = mine.data?.items.find((item) => item.slug === workspaceSlug);
  const me = useQuery({
    ...getWorkspaceMeQueryOptions(workspace?.id ?? ''),
    enabled: Boolean(workspace),
  });
  const current = useWorkspaceStore((state) => state.current);
  const access = usePageAccess(pathname, 'workspace');

  useEffect(() => {
    if (!workspace) return undefined;
    useWorkspaceStore
      .getState()
      .setCurrent({ id: workspace.id, slug: workspace.slug, name: workspace.name });
    return () => {
      useWorkspaceStore.getState().clear();
      usePermissionStore.getState().clearWorkspacePermissions();
    };
  }, [workspace]);

  useEffect(() => {
    if (me.data && me.data.workspace.id === workspace?.id) {
      usePermissionStore.getState().setWorkspacePermissions(me.data.permissions as PermissionKey[]);
    }
  }, [me.data, workspace?.id]);

  if (mine.isPending) return <PageSkeleton />;
  if (!workspace || me.isError) {
    return (
      <ErrorPage
        code="404"
        title={t('workspace.notFound.title')}
        description={t('workspace.notFound.description')}
        data-testid="workspace-not-found"
      />
    );
  }
  if (!me.data || current?.id !== workspace.id || !access.hydrated) return <PageSkeleton />;
  if (access.gated && !access.canAccess) return <ForbiddenPage />;
  return <Outlet />;
}
