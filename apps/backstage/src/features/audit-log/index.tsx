import * as Pages from './pages';
import * as Routes from './routes';

Routes.AuditLogListRoute.update({ component: Pages.AsyncAuditLogListPage });

export { Routes };
export { AUDIT_LOG_FEATURE } from './routes';
export { AUDIT_LOG_PAGE, registerAuditLogPagePermissions } from './permission';
export { appContextPlugin as auditLogFeaturePlugin } from './plugin';
export { registerAuditLogNavigation } from './navigation';
