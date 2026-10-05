import type { BatchAction } from '@b2b-system/web-core/batch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import { ApprovalBatchOperation } from '../../batch';
import { useApprovalPermission } from '../../hooks/useApprovalPermission';
import type { ApprovalRowVM } from './adapter';

/**
 * 審批列表的批次動作（docs/architecture/frontend/07-ui-system.md §13）：逐筆的「快速核准／快速駁回」——不指派角色、不附意見；
 * 要指派角色請開審核對話框逐筆審。資格沿用 adapter 算好的列旗標。
 */
export function useApprovalBatchActions(): Array<BatchAction<ApprovalRowVM>> {
  const { t } = useTranslation();
  const permission = useApprovalPermission();
  // 權限未水合前不出現操作按鈕（docs/conventions/02-frontend.md §3.2）
  const hidden = !permission.hydrated || !permission.canReview;

  return useMemo(
    () => [
      {
        id: 'approve',
        label: t('approval.batch.approve.action'),
        tone: 'success',
        hidden,
        isEligible: (row) => row.canApprove,
        ineligibleReason: t('approval.batch.approve.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('approval.batch.approve.title'),
          description: t('approval.batch.approve.confirm', { count: eligible.length }),
          confirmLabel: t('approval.approve.action'),
        }),
        operation: ApprovalBatchOperation.APPROVE,
      },
      {
        id: 'reject',
        label: t('approval.batch.reject.action'),
        tone: 'danger',
        hidden,
        isEligible: (row) => row.canReview,
        ineligibleReason: t('approval.batch.reject.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('approval.batch.reject.title'),
          description: t('approval.batch.reject.confirm', { count: eligible.length }),
          confirmLabel: t('approval.reject.action'),
        }),
        operation: ApprovalBatchOperation.REJECT,
      },
    ],
    [hidden, t],
  );
}
