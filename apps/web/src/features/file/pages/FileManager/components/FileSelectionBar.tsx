import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';

interface FileSelectionBarProps {
  count: number;
  total: number;
  /** 選取裡有檔案才能下載（資料夾不下載）。 */
  canDownload: boolean;
  canDelete: boolean;
  /** 只選一個、有改名權限時顯示。 */
  canRename: boolean;
  canMove: boolean;
  /** 只選一個資料夾、能管理它的授權時顯示「共用」。 */
  canShare: boolean;
  /** 只選一個鎖住的資料夾時顯示「申請存取」。 */
  canRequestAccess: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: () => void;
  onMove: () => void;
  onShare: () => void;
  onRequestAccess: () => void;
}

/**
 * 主區塊上方的選取列：改名（單選）、移動、批次下載、批次刪除（刪除送進全域佇列逐筆處理）。
 * 沒有選取時顯示操作提示而不是消失——框選途中它若突然出現，會把主區塊往下推，框就跟著跳動。
 */
export function FileSelectionBar({
  count,
  total,
  canDownload,
  canDelete,
  canRename,
  canMove,
  canShare,
  canRequestAccess,
  onSelectAll,
  onClear,
  onDownload,
  onDelete,
  onRename,
  onMove,
  onShare,
  onRequestAccess,
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
      <span className="ml-auto flex flex-wrap gap-2">
        {canRename && count === 1 && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="edit" size={14} />}
            onClick={onRename}
            data-testid="file-selection-rename"
          >
            {t('file.rename.action')}
          </Button>
        )}
        {canMove && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="folder-move" size={14} />}
            onClick={onMove}
            data-testid="file-selection-move"
          >
            {t('file.move.open')}
          </Button>
        )}
        {canRequestAccess && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="lock" size={14} />}
            onClick={onRequestAccess}
            data-testid="file-selection-request-access"
          >
            {t('file.access.request')}
          </Button>
        )}
        {canShare && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="users" size={14} />}
            onClick={onShare}
            data-testid="file-selection-share"
          >
            {t('file.share.open')}
          </Button>
        )}
        {canDownload && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="download" size={14} />}
            onClick={onDownload}
            data-testid="file-selection-download"
          >
            {t('file.download')}
          </Button>
        )}
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
