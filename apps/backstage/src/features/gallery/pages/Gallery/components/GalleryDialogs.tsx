import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';
import type { GalleryAlbum, GalleryItem, GalleryItemDetail } from '@/shared/api-sdk';

import { AddFromSourcesDialog } from '../../../components/AddFromSourcesDialog';
import { AddToAlbumDialog } from '../../../components/AddToAlbumDialog';
import { AlbumFormDialog } from '../../../components/AlbumFormDialog';
import { BatchTagDialog } from '../../../components/BatchTagDialog';
import { GalleryTagDialog } from '../../../components/GalleryTagDialog';
import { useGalleryAlbumDeleteMutation } from '../../../hooks/useGalleryMutations';
import { GalleryRoute } from '../../../routes';

/** 圖片庫頁同時最多開一個對話框。 */
export type GalleryDialog =
  | { kind: 'albumForm'; album?: GalleryAlbum }
  | { kind: 'addToAlbum'; itemIds: readonly string[] }
  | { kind: 'batchTag'; items: readonly GalleryItem[] }
  | { kind: 'addFromSources' }
  | { kind: 'tag'; item: GalleryItemDetail }
  | { kind: 'delete'; items: readonly GalleryItem[] }
  | { kind: 'deleteAlbum'; album: GalleryAlbum };

interface GalleryDialogsProps {
  dialog: GalleryDialog | null;
  onClose: () => void;
  albumId: string | undefined;
  canCreate: boolean;
  onDeleteItems: (items: readonly GalleryItem[]) => void;
  /** 批次操作送出之後清掉選取。 */
  onSelectionDone: () => void;
}

/** 圖片庫頁的對話框（相簿、加入相簿、標籤、從其他來源加入、刪除的確認）。 */
export function GalleryDialogs({
  dialog,
  onClose,
  albumId,
  canCreate,
  onDeleteItems,
  onSelectionDone,
}: GalleryDialogsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deleteAlbum = useGalleryAlbumDeleteMutation();
  // 回收桶被平台關掉時，確認文字不提「移到回收桶、還原」
  const hasTrash = useIsFeatureReady(TenantFeature.trash);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'albumForm':
      return (
        <AlbumFormDialog
          album={dialog.album}
          onClose={onClose}
          onSaved={(saved) => {
            if (!dialog.album) {
              void navigate({ to: '/gallery/album/$albumId', params: { albumId: saved.id } });
            }
          }}
        />
      );
    case 'addToAlbum':
      return (
        <AddToAlbumDialog
          itemIds={dialog.itemIds}
          canCreateAlbum={canCreate}
          onClose={onClose}
          onDone={onSelectionDone}
        />
      );
    case 'batchTag':
      return (
        <BatchTagDialog
          items={dialog.items}
          onClose={() => {
            onClose();
            onSelectionDone();
          }}
        />
      );
    case 'addFromSources':
      return <AddFromSourcesDialog albumId={albumId} onClose={onClose} />;
    case 'tag':
      return <GalleryTagDialog item={dialog.item} onClose={onClose} />;
    case 'delete':
      return (
        <AlertDialog
          open
          onOpenChange={(open) => !open && onClose()}
          title={t('gallery.delete.title', { count: dialog.items.length })}
          description={
            hasTrash ? t('gallery.delete.description') : t('gallery.delete.descriptionNoTrash')
          }
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          onConfirm={() => {
            onDeleteItems(dialog.items);
            onSelectionDone();
            onClose();
          }}
          data-testid="gallery-delete-confirm"
        />
      );
    case 'deleteAlbum':
      return (
        <AlertDialog
          open
          onOpenChange={(open) => !open && onClose()}
          title={t('gallery.album.delete.title', { name: dialog.album.name })}
          description={
            hasTrash
              ? t('gallery.album.delete.description')
              : t('gallery.album.delete.descriptionNoTrash')
          }
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          loading={deleteAlbum.isPending}
          onConfirm={async () => {
            await deleteAlbum.mutateAsync({ params: { albumId: dialog.album.id } });
            onClose();
            void navigate({ to: GalleryRoute.to });
          }}
          data-testid="gallery-album-delete-confirm"
        />
      );
  }
}
