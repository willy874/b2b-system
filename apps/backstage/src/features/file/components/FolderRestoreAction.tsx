import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';
import type { TrashRestoreActionProps } from '@/core/trash';

import { useFolderRestoreMutation } from '../hooks/useFolderMutations';

/** 回收桶「資料夾」分頁每一列的還原按鈕：同一次刪除的子資料夾與檔案一起回來（登記在 `trash.ts`）。 */
export function FolderRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useFolderRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { folderId: item.id } })}
      data-testid="file-folder-restore"
      data-value={item.id}
    >
      {t('file.restore.action')}
    </Button>
  );
}
