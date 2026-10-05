import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { TrashRestoreActionProps } from '@/core/trash';

import { useUserRestoreMutation } from '../hooks/useUserMutations';

/** 回收桶「使用者」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function UserRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useUserRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { userId: item.id } })}
      data-testid="user-restore"
      data-value={item.id}
    >
      {t('user.restore.action')}
    </Button>
  );
}
