import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { TrashRestoreActionProps } from '@/core/trash';

import { useFileRestoreMutation } from '../hooks/useFileMutations';

/** 回收桶「檔案」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function FileRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useFileRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { fileId: item.id } })}
      data-testid="file-restore"
      data-value={item.id}
    >
      {t('file.restore.action')}
    </Button>
  );
}
