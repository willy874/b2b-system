import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getApprovalDetailQueryOptions } from '@/apis/approval/get-approval-detail/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';

import { APPROVAL_TYPE_LABEL_KEY } from '../../../constants';
import { toApprovalDetailVM } from '../adapter';
import { useApprovalReview } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';
import { ApprovalChainActions } from './ApprovalChainActions';
import { ApprovalReviewActions } from './ApprovalReviewActions';
import { ApprovalReviewForm } from './ApprovalReviewForm';
import { ApprovalSummary } from './ApprovalSummary';
import { ApprovalTimeline } from './ApprovalTimeline';

interface ApprovalDetailDialogProps {
  approvalId: string;
  /** 關閉對話框（回到開啟它的列表）；審核成功後的關閉帶 `ignoreBlocker`。 */
  onClose: (options?: { ignoreBlocker?: boolean }) => void;
  /** 找不到這筆時「回到列表」按鈕的文字（審批總表與「我的審批」不同）。 */
  backLabel: string;
}

/**
 * 審批的詳情與審核：審批總表（`/approval/$approvalId`）與「我的審批」（`/my-approvals/$approvalId`）共用
 * （docs/architecture/backend/20-approval.md §9.16）。能做什麼由後端的 `viewer` 決定。
 */
export function ApprovalDetailDialog({
  approvalId,
  onClose,
  backLabel,
}: ApprovalDetailDialogProps) {
  const { t } = useTranslation();
  const detail = useQuery(getApprovalDetailQueryOptions(approvalId));
  const approval = useMemo(() => detail.data && toApprovalDetailVM(detail.data), [detail.data]);
  const access = useApprovalReviewAccess(approval);
  // 審核成功後的關閉略過未儲存提醒；其他關閉途徑（關閉鈕、Esc、點遮罩、上一頁）在有輸入時先確認
  const review = useApprovalReview(approvalId, () => onClose({ ignoreBlocker: true }));
  useUnsavedChangesGuard(review.isDirty);
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: access.canAssignRole });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={approval ? t(APPROVAL_TYPE_LABEL_KEY[approval.type]) : t('approval.detail.title')}
      description={approval?.requesterName}
      size="lg"
      data-testid="approval-detail-dialog"
      footer={
        <>
          <Button onClick={() => onClose()} data-testid="approval-detail-close">
            {t('common.close')}
          </Button>
          <ApprovalChainActions approval={approval} review={review} />
          <ApprovalReviewActions approval={approval} review={review} />
        </>
      }
    >
      {detail.isPending && <Skeleton height={200} />}
      {/* 例：從通知點進一筆已不存在（或看不到）的審批：說明原因並提供返回，不留一個只有標題的空對話框 */}
      {detail.isError && (
        <QueryError
          error={detail.error}
          onRetry={isNotFound(detail.error) ? undefined : () => void detail.refetch()}
          action={
            <Button onClick={() => onClose()} data-testid="approval-detail-back">
              {backLabel}
            </Button>
          }
          data-testid="approval-detail-error"
        />
      )}

      {approval && (
        <div className="flex flex-col gap-5">
          <ApprovalSummary approval={approval} />
          <ApprovalTimeline steps={approval.steps} />
          <ApprovalReviewForm approval={approval} review={review} roleOptions={roles.data?.items} />
        </div>
      )}
    </Dialog>
  );
}
