import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';
import type { TrashRestoreActionProps } from '@/core/trash';

import { useGroupRestoreMutation } from '../hooks/useGroupMutations';

/** 回收桶「群組」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function GroupRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useGroupRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { groupId: item.id } })}
      data-testid="group-restore"
      data-value={item.id}
    >
      {t('group.restore.action')}
    </Button>
  );
}
