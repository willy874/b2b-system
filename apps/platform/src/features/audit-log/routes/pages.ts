import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { AUDIT_LOG_LOCALE_SCOPE } from '../locale';
import { AuditLogSearchQuerySchema, DEFAULT_AUDIT_LOG_SEARCH } from './model';

/**
 * 平台稽核（`platformAuditLog:read`）：平台管理者對租戶、平台管理者等資源做過的操作。
 * 篩選條件與分頁放在網址上，重新整理或分享連結都保留。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const AuditLogListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/audit-log',
  staticData: { titleKey: 'menu.auditLog' },
  loader: localeScopeLoader(AUDIT_LOG_LOCALE_SCOPE),
  validateSearch: AuditLogSearchQuerySchema,
  // 等於預設值的參數不寫進網址
  search: { middlewares: [stripSearchParams(DEFAULT_AUDIT_LOG_SEARCH)] },
});
