import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

import { ApprovalDetailRoute, ApprovalListRoute } from '../../routes';
import { ApprovalDetailDialog } from './components/ApprovalDetailDialog';

export default function ApprovalDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { approvalId } = ApprovalDetailRoute.useParams();
  const search = ApprovalListRoute.useSearch();

  return (
    <ApprovalDetailDialog
      approvalId={approvalId}
      backLabel={t('approval.detail.backToList')}
      onClose={(options) => void navigate({ to: ApprovalListRoute.to, search, ...options })}
    />
  );
}
