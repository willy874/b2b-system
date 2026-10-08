import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { APPROVAL_LOCALE_SCOPE } from '../locale';
import {
  ApprovalSearchQuerySchema,
  DEFAULT_APPROVAL_SEARCH,
  DEFAULT_MY_APPROVAL_SEARCH,
  MyApprovalSearchQuerySchema,
} from './model';

export const ApprovalListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/approval',
  staticData: { titleKey: 'menu.approval' },
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
  getParentRoute: () => MyApprovalRoute,
  path: '$approvalId',
});
