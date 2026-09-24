import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncAuditLogListPage = lazyRouteComponent(() => import('./AuditLogList/page'));
