import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { BrowserItemVM } from '../adapter';

interface FileDeleteDialogProps {
  /** 要刪除的項目；`undefined` 時關閉。 */
  items: readonly BrowserItemVM[] | undefined;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/** 刪除確認。刪除＝移到回收桶；包含資料夾時明講「其中的檔案與子資料夾一併移到回收桶」。 */
export function FileDeleteDialog({ items, loading, onCancel, onConfirm }: FileDeleteDialogProps) {
  const { t } = useTranslation();
  const count = items?.length ?? 0;
  const [only] = items ?? [];
  const hasFolder = items?.some((item) => item.type === 'folder') ?? false;
  const description =
    count > 1
      ? hasFolder
        ? t('file.batch.deleteFolder.confirm', { count })
        : t('file.batch.delete.confirm', { count })
      : only?.type === 'folder'
        ? t('file.folder.delete.confirm', { name: only.name })
        : t('file.delete.confirm', { name: only?.name ?? '' });

  return (
    <AlertDialog
      open={count > 0}
      onOpenChange={(open) => !open && onCancel()}
      title={hasFolder ? t('file.folder.delete.title') : t('file.delete.title')}
      description={description}
      confirmLabel={t('common.delete')}
      cancelLabel={t('common.cancel')}
      loading={loading}
      onConfirm={onConfirm}
      data-testid="file-delete-dialog"
    />
  );
}
