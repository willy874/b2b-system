import { Button } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { useTranslation } from '@b2b-system/web-core/locales';

interface FileEmptyStateProps {
  hasFilters: boolean;
  /** 在資料夾裡（不是根目錄）。 */
  inFolder: boolean;
  canUpload: boolean;
  onClearFilters: () => void;
}

/** 主區塊沒有任何項目時：篩選後沒結果、空資料夾、還沒有任何檔案，三種說法不同。 */
export function FileEmptyState({
  hasFilters,
  inFolder,
  canUpload,
  onClearFilters,
}: FileEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <Empty
      title={
        hasFilters
          ? t('file.empty.filtered')
          : inFolder
            ? t('file.empty.folder')
            : t('file.empty.title')
      }
      description={!hasFilters && canUpload ? t('file.empty.uploadHint') : undefined}
      action={
        hasFilters ? (
          <Button onClick={onClearFilters}>{t('file.empty.clearFilters')}</Button>
        ) : undefined
      }
      data-testid="file-empty"
    />
  );
}
