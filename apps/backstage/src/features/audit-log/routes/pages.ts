import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { AUDIT_LOG_LOCALE_SCOPE } from '../locale';
import { AuditLogSearchQuerySchema, DEFAULT_AUDIT_LOG_SEARCH } from './model';

/**
 * 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`）。可啟用的 feature 由平台管理者對每個租戶開關，
 * 登入後才安裝（docs/architecture/frontend/02-plugin-system.md §9）。
 */
export const AUDIT_LOG_FEATURE = 'auditLog';

export const AuditLogListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/audit-log',
  // 未啟用 → 404；清單還沒到或安裝中 → 等待，語系包的 loader 要在安裝之後才跑（docs/architecture/frontend/02-plugin-system.md §9.2 D6）
  beforeLoad: requireFeature(AUDIT_LOG_FEATURE),
  loader: localeScopeLoader(AUDIT_LOG_LOCALE_SCOPE),
  validateSearch: AuditLogSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_AUDIT_LOG_SEARCH)] },
});
