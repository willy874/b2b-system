import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { APPROVAL_LOCALE_SCOPE } from '../locale';
import {
  ApprovalDetailSearchSchema,
  ApprovalSearchQuerySchema,
  DEFAULT_APPROVAL_SEARCH,
  DEFAULT_MY_APPROVAL_SEARCH,
  MyApprovalDetailSearchSchema,
  MyApprovalSearchQuerySchema,
} from './model';

export const ApprovalListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/approval',
  staticData: { titleKey: 'menu.approval' },
  loader: localeScopeLoader(APPROVAL_LOCALE_SCOPE),
  validateSearch: ApprovalSearchQuerySchema,
  // 等於預設值的參數不寫進網址
  search: { middlewares: [stripSearchParams(DEFAULT_APPROVAL_SEARCH)] },
});

/**
 * 審批詳情：整頁（docs/architecture/backend/20-approval.md §11.3、§12 D1）。網址帶著列表的條件，回到列表時還原篩選；
 * 頁面權限落在列表的頁面鍵上（前綴）。
 */
export const ApprovalDetailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/approval/$approvalId',
  staticData: { titleKey: 'menu.approval' },
  loader: localeScopeLoader(APPROVAL_LOCALE_SCOPE),
  validateSearch: ApprovalDetailSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_APPROVAL_SEARCH)] },
});

/**
 * 「我的審批」：待我審核（多階段的關卡）與我送出的申請（docs/architecture/backend/20-approval.md §9.10）。
 * 個人頁，不需要權限；看得到哪些由後端依申請人與候選人決定。
 */
export const MyApprovalRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/my-approvals',
  staticData: { titleKey: 'menu.myApproval' },
  loader: localeScopeLoader(APPROVAL_LOCALE_SCOPE),
  validateSearch: MyApprovalSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_MY_APPROVAL_SEARCH)] },
});

export const MyApprovalDetailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/my-approvals/$approvalId',
  staticData: { titleKey: 'menu.myApproval' },
  loader: localeScopeLoader(APPROVAL_LOCALE_SCOPE),
  validateSearch: MyApprovalDetailSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_MY_APPROVAL_SEARCH)] },
});
