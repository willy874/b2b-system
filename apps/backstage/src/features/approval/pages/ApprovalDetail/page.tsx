import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalDetailQueryOptions } from '@/apis/approval/get-approval-detail/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';

import { APPROVAL_TYPE_LABEL_KEY } from '../../constants';
import { ApprovalDetailRoute, ApprovalListRoute } from '../../routes';
import { toApprovalDetailVM } from './adapter';
import { ApprovalReviewActions } from './components/ApprovalReviewActions';
import { ApprovalReviewForm } from './components/ApprovalReviewForm';
import { ApprovalSummary } from './components/ApprovalSummary';
import { useApprovalReview } from './useApprovalReview';
import { useApprovalReviewAccess } from './useApprovalReviewAccess';

export default function ApprovalDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { approvalId } = ApprovalDetailRoute.useParams();
  const search = ApprovalListRoute.useSearch();
  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: ApprovalListRoute.to, search, ...options });

  const detail = useQuery(getApprovalDetailQueryOptions(approvalId));
  const approval = useMemo(() => detail.data && toApprovalDetailVM(detail.data), [detail.data]);
  const access = useApprovalReviewAccess(approval);
  // 審核成功後的關閉略過未儲存提醒；其他關閉途徑（關閉鈕、Esc、點遮罩、上一頁）在有輸入時先確認
  const review = useApprovalReview(approvalId, () => close({ ignoreBlocker: true }));
  useUnsavedChangesGuard(review.isDirty);
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: access.canAssignRole });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={approval ? t(APPROVAL_TYPE_LABEL_KEY[approval.type]) : t('approval.detail.title')}
      description={approval?.requesterName}
      size="lg"
      data-testid="approval-detail-dialog"
      footer={
        <>
          <Button onClick={() => close()} data-testid="approval-detail-close">
            {t('common.close')}
          </Button>
          <ApprovalReviewActions approval={approval} review={review} />
        </>
      }
    >
      {detail.isPending && <Skeleton height={200} />}

      {approval && (
        <div className="flex flex-col gap-5">
          <ApprovalSummary approval={approval} />
          <ApprovalReviewForm approval={approval} review={review} roleOptions={roles.data?.items} />
        </div>
      )}
    </Dialog>
  );
}
