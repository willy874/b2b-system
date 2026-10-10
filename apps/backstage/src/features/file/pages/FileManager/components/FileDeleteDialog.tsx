import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { useTranslation } from '@b2b-system/web-core/locales';

import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import type { BrowserItemVM } from '../adapter';

interface FileDeleteDialogProps {
  /** 要刪除的項目；`undefined` 時關閉。 */
  items: readonly BrowserItemVM[] | undefined;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

const CONFIRM_KEY = {
  batchWithFolder: 'file.batch.deleteFolder.confirm',
  batch: 'file.batch.delete.confirm',
  folder: 'file.folder.delete.confirm',
  file: 'file.delete.confirm',
} as const;

/** 回收桶被平台關掉時的文字：不提「移到回收桶、可以還原」（那時沒有地方可以還原）。 */
const CONFIRM_NO_TRASH_KEY = {
  batchWithFolder: 'file.batch.deleteFolder.confirmNoTrash',
  batch: 'file.batch.delete.confirmNoTrash',
  folder: 'file.folder.delete.confirmNoTrash',
  file: 'file.delete.confirmNoTrash',
} as const satisfies Record<keyof typeof CONFIRM_KEY, string>;

/**
 * 刪除確認。刪除＝移到回收桶；包含資料夾時明講「其中的檔案與子資料夾一併移到回收桶」。
 * 租戶沒有啟用 `trash` 時改用不提回收桶的文字。
 */
export function FileDeleteDialog({ items, loading, onCancel, onConfirm }: FileDeleteDialogProps) {
  const { t } = useTranslation();
  const count = items?.length ?? 0;
  const [only] = items ?? [];
  const hasFolder = items?.some((item) => item.type === 'folder') ?? false;
  const keys = useIsFeatureReady(TenantFeature.trash) ? CONFIRM_KEY : CONFIRM_NO_TRASH_KEY;
  const description =
    count > 1
      ? hasFolder
        ? t(keys.batchWithFolder, { count })
        : t(keys.batch, { count })
      : only?.type === 'folder'
        ? t(keys.folder, { name: only.name })
        : t(keys.file, { name: only?.name ?? '' });

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
