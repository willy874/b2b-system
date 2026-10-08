import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

import { MyApprovalDetailRoute, MyApprovalRoute } from '../../routes';
import { ApprovalDetailDialog } from '../ApprovalDetail/components/ApprovalDetailDialog';

/** 「我的審批」的詳情：與審批總表同一個對話框，關閉時回到「我的審批」。 */
export default function MyApprovalDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { approvalId } = MyApprovalDetailRoute.useParams();
  const search = MyApprovalRoute.useSearch();

  return (
    <ApprovalDetailDialog
      approvalId={approvalId}
      backLabel={t('approval.my.backToList')}
      onClose={(options) => void navigate({ to: MyApprovalRoute.to, search, ...options })}
    />
  );
}
