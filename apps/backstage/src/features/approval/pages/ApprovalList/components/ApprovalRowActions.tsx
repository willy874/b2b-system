import { IconButton } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';

import {
  useApproveApprovalMutation,
  useRejectApprovalMutation,
} from '../../../hooks/useApprovalMutations';
import type { ApprovalRowVM } from '../adapter';

interface ApprovalRowActionsProps {
  row: ApprovalRowVM;
}

/**
 * 列上的快速審核：確認後直接核准或駁回，不開審核對話框（docs/architecture/backend/20-approval.md §6）。
 * 快速核准 **不指派角色**、不附意見；要指派角色請開對話框逐筆審。
 */
export function ApprovalRowActions({ row }: ApprovalRowActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const approve = useApproveApprovalMutation();
  const reject = useRejectApprovalMutation();

  if (!row.canReview) return null;

  // 失敗時提示並重拋：確認框留著，讓審核者決定重試或取消
  const reportError = (error: unknown): never => {
    showError(error);
    throw error;
  };

  return (
    <div className="flex gap-1">
      <Tooltip
        content={
          row.canApprove
            ? t('approval.quickApprove.action')
            : t('approval.review.missingCreatePermission')
        }
      >
        <IconButton
          size="sm"
          aria-label={t('approval.quickApprove.action')}
          disabled={!row.canApprove}
          onClick={() =>
            void confirm({
              title: t('approval.quickApprove.title'),
              description: t('approval.quickApprove.confirm', { name: row.requesterName }),
              confirmLabel: t('approval.approve.action'),
              tone: 'primary',
              onConfirm: () =>
                approve
                  .mutateAsync({ params: { approvalId: row.id, body: { roleIds: [] } } })
                  .catch(reportError),
            })
          }
          data-testid="approval-quick-approve"
          data-value={row.requesterName}
        >
          <Icon name="check" size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip content={t('approval.quickReject.action')}>
        <IconButton
          size="sm"
          aria-label={t('approval.quickReject.action')}
          onClick={() =>
            void confirm({
              title: t('approval.quickReject.title'),
              description: t('approval.quickReject.confirm', { name: row.requesterName }),
              confirmLabel: t('approval.reject.action'),
              tone: 'danger',
              onConfirm: () =>
                reject.mutateAsync({ params: { approvalId: row.id, body: {} } }).catch(reportError),
            })
          }
          data-testid="approval-quick-reject"
          data-value={row.requesterName}
        >
          <Icon name="close" size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
