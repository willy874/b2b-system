import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

interface GallerySelectionBarProps {
  count: number;
  loaded: number;
  canUpdate: boolean;
  canDelete: boolean;
  /** 在相簿頁：可以移出相簿。 */
  inAlbum: boolean;
  /** 列表的顯示方式沒有框選，提示不提它。 */
  listLayout: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onAddToAlbum: () => void;
  onRemoveFromAlbum: () => void;
  onTag: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * 批次操作（docs/architecture/frontend/24-gallery.md §5）：加入或移出相簿、貼標籤、逐張下載、刪除。
 * 沒有選取時顯示操作提示而不是消失：框選途中它突然出現會把版面往下推。
 */
export function GallerySelectionBar({
  count,
  loaded,
  canUpdate,
  canDelete,
  inAlbum,
  listLayout,
  onSelectAll,
  onClear,
  onAddToAlbum,
  onRemoveFromAlbum,
  onTag,
  onDownload,
  onDelete,
}: GallerySelectionBarProps) {
  const { t } = useTranslation();
  if (count === 0) {
    return (
      <div
        className="hidden min-h-10 items-center px-3 text-xs text-[var(--color-fg-muted)] sm:flex"
        data-testid="gallery-selection-bar"
        data-value={0}
      >
        {listLayout ? t('gallery.selection.listHint') : t('gallery.selection.hint')}
      </div>
    );
  }
  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-3 py-1 text-sm"
      data-testid="gallery-selection-bar"
      data-value={count}
    >
      <span data-testid="gallery-selection-count" data-value={count}>
        {t('gallery.selection.count', { count })}
      </span>
      {count < loaded && (
        <Button size="sm" variant="ghost" onClick={onSelectAll} data-testid="gallery-selection-all">
          {t('gallery.selection.selectLoaded', { count: loaded })}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="gallery-selection-clear">
        {t('common.clear')}
      </Button>
      <span className="ml-auto flex flex-wrap gap-2">
        {canUpdate && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="folder-plus" size={14} />}
            onClick={onAddToAlbum}
            data-testid="gallery-selection-add-to-album"
          >
            {t('gallery.album.add.action')}
          </Button>
        )}
        {canUpdate && inAlbum && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="minus" size={14} />}
            onClick={onRemoveFromAlbum}
            data-testid="gallery-selection-remove-from-album"
          >
            {t('gallery.album.remove.action')}
          </Button>
        )}
        {canUpdate && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="tag" size={14} />}
            onClick={onTag}
            data-testid="gallery-selection-tag"
          >
            {t('gallery.batch.tag.action')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          startIcon={<Icon name="download" size={14} />}
          onClick={onDownload}
          data-testid="gallery-selection-download"
        >
          {t('gallery.download.action')}
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="danger"
            startIcon={<Icon name="trash" size={14} />}
            onClick={onDelete}
            data-testid="gallery-selection-delete"
          >
            {t('common.delete')}
          </Button>
        )}
      </span>
    </div>
  );
}
