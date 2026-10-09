import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { TrashRestoreActionProps } from '@/core/trash';

import {
  useGalleryAlbumRestoreMutation,
  useGalleryItemRestoreMutation,
} from '../hooks/useGalleryMutations';

/** 回收桶「圖片庫」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function GalleryItemRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useGalleryItemRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { itemId: item.id } })}
      data-testid="gallery-item-restore"
      data-value={item.id}
    >
      {t('gallery.restore.action')}
    </Button>
  );
}

/** 回收桶「相簿」分頁的還原按鈕：相簿裡的圖片關聯一起回來。 */
export function GalleryAlbumRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useGalleryAlbumRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { albumId: item.id } })}
      data-testid="gallery-album-restore"
      data-value={item.id}
    >
      {t('gallery.restore.action')}
    </Button>
  );
}
