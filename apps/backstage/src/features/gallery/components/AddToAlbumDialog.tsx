import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { FormError } from '@b2b-system/ui/FormError';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import { useGalleryAlbumAddItemsMutation } from '../hooks/useGalleryMutations';
import { useResolveAlbum } from '../hooks/useResolveAlbum';
import { AlbumPicker, isAlbumChoiceValid } from './AlbumPicker';
import type { AlbumChoice } from './AlbumPicker';

interface AddToAlbumDialogProps {
  itemIds: readonly string[];
  canCreateAlbum: boolean;
  onClose: () => void;
  onDone?: () => void;
}

/** 把選取的圖片加入一個相簿（一次一個請求；已經在的略過）。 */
export function AddToAlbumDialog({
  itemIds,
  canCreateAlbum,
  onClose,
  onDone,
}: AddToAlbumDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [album, setAlbum] = useState<AlbumChoice>({ kind: 'none' });
  const [error, setError] = useState<unknown>();
  const add = useGalleryAlbumAddItemsMutation();
  const resolveAlbum = useResolveAlbum();
  const isPending = add.isPending || resolveAlbum.isPending;

  const submit = async () => {
    setError(undefined);
    try {
      const albumId = await resolveAlbum.resolve(album);
      if (!albumId) return;
      await add.mutateAsync({ params: { albumId, body: { itemIds: [...itemIds] } } });
      onDone?.();
      onClose();
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('gallery.album.add.title', { count: itemIds.length })}
      size="sm"
      data-testid="gallery-add-to-album"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={isPending}
            disabled={album.kind === 'none' || !isAlbumChoiceValid(album)}
            onClick={() => void submit()}
            data-testid="gallery-add-to-album-submit"
          >
            {t('gallery.album.add.submit')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <AlbumPicker
          value={album}
          onChange={setAlbum}
          canCreate={canCreateAlbum}
          allowNone={false}
          disabled={isPending}
        />
        {error !== undefined && <FormError>{errorMessage(error)}</FormError>}
      </div>
    </Dialog>
  );
}
