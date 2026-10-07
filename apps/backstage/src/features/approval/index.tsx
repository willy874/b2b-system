import * as Pages from './pages';
import * as Routes from './routes';

Routes.ApprovalListRoute.update({ component: Pages.AsyncApprovalListPage });
Routes.ApprovalDetailRoute.update({ component: Pages.AsyncApprovalDetailPage });

export { Routes };
export { APPROVAL_PAGE, registerApprovalPagePermissions } from './permission';
export { appContextPlugin as approvalFeaturePlugin } from './plugin';
export { registerApprovalNavigation } from './navigation';
