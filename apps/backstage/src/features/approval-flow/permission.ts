import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { ApprovalFlowListRoute } from './routes/pages';

/** 列表與編輯頁共用（編輯頁的路徑 `/approval-flow/$type` 以前綴落在這裡）；能不能改看 `approvalFlow:update`。 */
export const APPROVAL_FLOW_PAGE = definePageKey('APPROVAL_FLOW');

export function registerApprovalFlowPagePermissions(): void {
  registerPagePermission(APPROVAL_FLOW_PAGE, {
    route: routeBasePath(ApprovalFlowListRoute), // '/approval-flow'
    // 沒有 `resource`：app 的 `PermissionResource` 還沒有 approvalFlow，`canUpdate` 由 facade 直接看權限鍵
    rule: { access: [PermissionKey['approvalFlow:read']], match: PermissionMatch.EVERY },
  });
}
