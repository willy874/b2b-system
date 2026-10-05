import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
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
  const close = () => void navigate({ to: ApprovalListRoute.to, search });

  const detail = useQuery(getApprovalDetailQueryOptions(approvalId));
  const approval = useMemo(() => detail.data && toApprovalDetailVM(detail.data), [detail.data]);
  const access = useApprovalReviewAccess(approval);
  const review = useApprovalReview(approvalId, close);
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
          <Button onClick={close}>{t('common.close')}</Button>
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
