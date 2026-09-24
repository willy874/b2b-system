import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { AUDIT_LOG_LOCALE_SCOPE } from '../locale';
import { AuditLogSearchQuerySchema, DEFAULT_AUDIT_LOG_SEARCH } from './model';

export const AuditLogListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/audit-log',
  loader: localeScopeLoader(AUDIT_LOG_LOCALE_SCOPE),
  validateSearch: AuditLogSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_AUDIT_LOG_SEARCH)] },
});
