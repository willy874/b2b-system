import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { APPROVAL_FLOW_LOCALE_SCOPE } from '../locale';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES` 的 `approvalChain`，docs/architecture/backend/20-approval.md §9.11）。 */
export const APPROVAL_FLOW_FEATURE = 'approvalChain';

/**
 * 支援多階段流程的審批類型：系統設定的「審批流程」分頁
 * （`approvalFlow:read`，docs/architecture/backend/20-approval.md §9.16、docs/architecture/frontend/02-plugin-system.md §4.5）。
 */
export const ApprovalFlowListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/approval-flows',
  staticData: { titleKey: 'menu.approvalFlow' },
  beforeLoad: requireFeature(APPROVAL_FLOW_FEATURE),
  loader: localeScopeLoader(APPROVAL_FLOW_LOCALE_SCOPE),
});

/**
 * 某個類型的流程編輯：整頁（關卡清單與試算面板放不進對話框），所以是與列表平行的最上層 route，
 * 不掛在列表底下；頁面權限沿用列表的 `APPROVAL_FLOW`（路徑前綴相同）。
 */
export const ApprovalFlowEditRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/approval-flows/$type',
  staticData: { titleKey: 'menu.approvalFlow' },
  beforeLoad: requireFeature(APPROVAL_FLOW_FEATURE),
  loader: localeScopeLoader(APPROVAL_FLOW_LOCALE_SCOPE),
});
