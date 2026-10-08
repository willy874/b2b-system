import * as Pages from './pages';
import * as Routes from './routes';

Routes.ApprovalFlowListRoute.update({ component: Pages.AsyncApprovalFlowListPage });
Routes.ApprovalFlowEditRoute.update({ component: Pages.AsyncApprovalFlowEditPage });

export { Routes };
export { APPROVAL_FLOW_FEATURE } from './routes';
export { APPROVAL_FLOW_PAGE, registerApprovalFlowPagePermissions } from './permission';
export { appContextPlugin as approvalFlowFeaturePlugin } from './plugin';
export { registerApprovalFlowNavigation } from './navigation';
