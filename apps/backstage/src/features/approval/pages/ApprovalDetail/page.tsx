import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

import { ApprovalDetailRoute, ApprovalListRoute } from '../../routes';
import { toApprovalListParams } from '../ApprovalList/adapter';
import { ApprovalDetailView } from './components/ApprovalDetailView';

/** 審批總表的詳情（`/approval/$approvalId`）：回到列表時帶著原本的篩選。 */
export default function ApprovalDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { approvalId } = ApprovalDetailRoute.useParams();
  const { queue, ...listSearch } = ApprovalDetailRoute.useSearch();

  return (
    <ApprovalDetailView
      key={approvalId}
      approvalId={approvalId}
      backLabel={t('approval.detail.backToList')}
      onBack={(options) =>
        void navigate({ to: ApprovalListRoute.to, search: listSearch, ...options })
      }
      onOpen={(id, options) =>
        void navigate({
          to: ApprovalDetailRoute.to,
          params: { approvalId: id },
          search: { ...listSearch, queue },
          ...options,
        })
      }
      queue={queue ? { ...toApprovalListParams(listSearch), scope: 'all' } : undefined}
    />
  );
}
