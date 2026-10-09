import { ButtonLink } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useRouteLinkAccess } from '@b2b-system/web-core/route-link';

import type { FolderAccessVM } from '../adapter';

interface ApprovalResubmitLinkProps {
  approvalId: string;
  folderAccess: FolderAccessVM;
}

/**
 * 資料夾存取申請的「修改後重新送出」（docs/architecture/backend/20-approval.md §11.3、§12 D8）：回到檔案管理器的申請對話框並預填。
 * 入口在擁有資源的 feature，經 route id 連過去（不 import 對方）；那個 feature 沒有啟用、或沒有權限時不顯示。
 */
export function ApprovalResubmitLink({ approvalId, folderAccess }: ApprovalResubmitLinkProps) {
  const { t } = useTranslation();
  const access = useRouteLinkAccess('file.requestAccess', {
    folderId: folderAccess.folderId,
    level: folderAccess.level,
    approvalId,
  });
  if (access.status !== 'ready') return null;
  return (
    <ButtonLink
      to={access.link.to}
      params={access.link.params}
      search={access.link.search}
      size="sm"
      variant="primary"
      data-testid="approval-resubmit-link"
    >
      {t('approval.banner.resubmit')}
    </ButtonLink>
  );
}
