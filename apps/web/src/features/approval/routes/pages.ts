import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { APPROVAL_LOCALE_SCOPE } from '../locale';
import { ApprovalSearchQuerySchema, DEFAULT_APPROVAL_SEARCH } from './model';

export const ApprovalListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/approval',
  loader: localeScopeLoader(APPROVAL_LOCALE_SCOPE),
  validateSearch: ApprovalSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_APPROVAL_SEARCH)] },
});

/** 審核對話框：疊在列表上，關閉時帶著原本的篩選條件回列表。 */
export const ApprovalDetailRoute = createRoute({
  getParentRoute: () => ApprovalListRoute,
  path: '$approvalId',
});
