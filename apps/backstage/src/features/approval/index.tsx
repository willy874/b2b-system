import * as Pages from './pages';
import * as Routes from './routes';

Routes.ApprovalListRoute.update({ component: Pages.AsyncApprovalListPage });
Routes.ApprovalDetailRoute.update({ component: Pages.AsyncApprovalDetailPage });
Routes.MyApprovalRoute.update({ component: Pages.AsyncMyApprovalListPage });
Routes.MyApprovalDetailRoute.update({ component: Pages.AsyncMyApprovalDetailPage });

export { Routes };
export { APPROVAL_PAGE, MY_APPROVAL_PAGE, registerApprovalPagePermissions } from './permission';
export { appContextPlugin as approvalFeaturePlugin } from './plugin';
export { registerApprovalNavigation } from './navigation';
