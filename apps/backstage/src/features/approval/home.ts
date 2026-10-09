import { lazy } from 'react';

import { registerHomeSection } from '@/core/home';

import { APPROVAL_LOCALE_SCOPE } from './locale';
import { MY_APPROVAL_PAGE } from './permission';

const PendingApprovalsSection = lazy(() =>
  import('./components/PendingApprovalsSection').then((module) => ({
    default: module.PendingApprovalsSection,
  })),
);

/** 首頁的「待辦」區塊（docs/architecture/backend/20-approval.md §11.1）：每個登入的人都可能有待審的關卡。 */
export function registerApprovalHomeSection(): void {
  registerHomeSection({
    key: 'pending-approvals',
    pageKey: MY_APPROVAL_PAGE,
    order: 100,
    Section: PendingApprovalsSection,
    localeScope: APPROVAL_LOCALE_SCOPE,
  });
}
