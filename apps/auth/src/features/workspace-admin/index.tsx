import * as Pages from './pages';
import * as Routes from './routes';

Routes.WorkspaceAdminListRoute.update({ component: Pages.AsyncWorkspaceAdminListPage });

export { Routes };
export { registerWorkspaceAdminPagePermissions, WORKSPACE_ADMIN_PAGE } from './permission';
export { appContextPlugin as workspaceAdminFeaturePlugin } from './plugin';
