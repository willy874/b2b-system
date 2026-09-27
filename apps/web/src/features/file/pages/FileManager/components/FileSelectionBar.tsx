import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';

interface FileSelectionBarProps {
  count: number;
  total: number;
  canDelete: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * 主區塊上方的選取列：批次下載、批次刪除（刪除送進全域佇列逐筆處理）。
 * 沒有選取時顯示操作提示而不是消失——框選途中它若突然出現，會把主區塊往下推，框就跟著跳動。
 */
export function FileSelectionBar({
  count,
  total,
  canDelete,
  onSelectAll,
  onClear,
  onDownload,
  onDelete,
}: FileSelectionBarProps) {
  const { t } = useTranslation();
  if (count === 0) {
    return (
      <div
        className="hidden min-h-10 items-center px-3 text-xs text-[var(--color-fg-muted)] sm:flex"
        data-testid="file-selection-bar"
        data-value={0}
      >
        {t('file.selection.hint')}
      </div>
    );
  }
  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-3 py-1 text-sm"
      data-testid="file-selection-bar"
      data-value={count}
    >
      <span data-testid="file-selection-count" data-value={count}>
        {t('file.selection.count', { count })}
      </span>
      {count < total && (
        <Button size="sm" variant="ghost" onClick={onSelectAll} data-testid="file-selection-all">
          {t('file.selection.selectAll', { count: total })}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="file-selection-clear">
        {t('common.clear')}
      </Button>
      <span className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          startIcon={<Icon name="download" size={14} />}
          onClick={onDownload}
          data-testid="file-selection-download"
        >
          {t('file.download')}
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="danger"
            startIcon={<Icon name="trash" size={14} />}
            onClick={onDelete}
            data-testid="file-selection-delete"
          >
            {t('common.delete')}
          </Button>
        )}
      </span>
    </div>
  );
}
