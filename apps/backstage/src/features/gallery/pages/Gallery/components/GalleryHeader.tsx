import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { CollectedUpload } from '@/core/upload';
import type { GalleryAlbum } from '@/shared/api-sdk';

import { GalleryUploadStatus } from '../../../components/GalleryUploadStatus';
import { GalleryAddMenu } from './GalleryAddMenu';

interface GalleryHeaderProps {
  album: GalleryAlbum | undefined;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onUpload: (upload: CollectedUpload) => void;
  onAddFromSources: () => void;
  onEditAlbum: (album: GalleryAlbum) => void;
  onDeleteAlbum: (album: GalleryAlbum) => void;
}

/** 頁首：標題（相簿頁是相簿名稱）、處理中的計數、相簿的動作、「加入」選單。 */
export function GalleryHeader({
  album,
  canCreate,
  canUpdate,
  canDelete,
  onUpload,
  onAddFromSources,
  onEditAlbum,
  onDeleteAlbum,
}: GalleryHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 truncate text-xl font-semibold" data-testid="gallery-title">
          {album ? album.name : t('gallery.title')}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {album
            ? (album.description ?? t('gallery.album.count', { count: album.itemCount }))
            : t('gallery.description')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && <GalleryUploadStatus />}
        {album && canUpdate && (
          <Button
            variant="secondary"
            startIcon={<Icon name="edit" size={14} />}
            onClick={() => onEditAlbum(album)}
            data-testid="gallery-album-edit"
          >
            {t('gallery.album.edit.action')}
          </Button>
        )}
        {album && canDelete && (
          <Button
            variant="danger"
            startIcon={<Icon name="trash" size={14} />}
            onClick={() => onDeleteAlbum(album)}
            data-testid="gallery-album-delete"
          >
            {t('gallery.album.delete.action')}
          </Button>
        )}
        {canCreate && <GalleryAddMenu onUpload={onUpload} onAddFromSources={onAddFromSources} />}
      </div>
    </header>
  );
}
