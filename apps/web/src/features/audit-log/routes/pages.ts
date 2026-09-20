import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { AUDIT_LOG_LOCALE_SCOPE } from '../locale';
import { AuditLogSearchQuerySchema } from './model';

export const AuditLogListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/audit-log',
  loader: localeScopeLoader(AUDIT_LOG_LOCALE_SCOPE),
  validateSearch: AuditLogSearchQuerySchema,
});
