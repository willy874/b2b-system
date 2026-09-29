import * as Pages from './pages';
import * as Routes from './routes';

Routes.WorkspaceRoute.update({ component: Pages.WorkspaceLayout });
Routes.WorkspaceMembersRoute.update({ component: Pages.AsyncWorkspaceMembersPage });

export { Routes };
export { useDefaultWorkspaceSlug, WorkspaceSwitcher } from './components/WorkspaceSwitcher';
export { registerWorkspacePagePermissions, WORKSPACE_MEMBER_PAGE } from './permission';
export { appContextPlugin as workspaceFeaturePlugin } from './plugin';
