import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { TrashRestoreActionProps } from '@/core/trash';

import { useAnnouncementRestoreMutation } from '../hooks/useAnnouncementMutations';

/** 回收桶「公告」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function AnnouncementRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useAnnouncementRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { announcementId: item.id } })}
      data-testid="announcement-restore"
      data-value={item.id}
    >
      {t('announcement.restore.action')}
    </Button>
  );
}
