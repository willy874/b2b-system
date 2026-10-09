import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

import { MyApprovalDetailRoute, MyApprovalRoute } from '../../routes';
import { ApprovalDetailView } from '../ApprovalDetail/components/ApprovalDetailView';
import { toMyApprovalListParams } from '../MyApprovalList/adapter';

/** 「我的審批」的詳情：與審批總表同一個頁面，回到「我的審批」；從「待我審核」進來時決定後前往下一筆。 */
export default function MyApprovalDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { approvalId } = MyApprovalDetailRoute.useParams();
  const { queue, ...listSearch } = MyApprovalDetailRoute.useSearch();

  return (
    <ApprovalDetailView
      key={approvalId}
      approvalId={approvalId}
      backLabel={t('approval.my.backToList')}
      onBack={(options) =>
        void navigate({ to: MyApprovalRoute.to, search: listSearch, ...options })
      }
      onOpen={(id, options) =>
        void navigate({
          to: MyApprovalDetailRoute.to,
          params: { approvalId: id },
          search: { ...listSearch, queue },
          ...options,
        })
      }
      queue={queue ? toMyApprovalListParams(listSearch, listSearch.tab ?? 'assigned') : undefined}
    />
  );
}
