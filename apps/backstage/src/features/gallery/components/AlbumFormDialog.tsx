import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { GalleryAlbum } from '@/shared/api-sdk';

import {
  useGalleryAlbumCreateMutation,
  useGalleryAlbumUpdateMutation,
} from '../hooks/useGalleryMutations';

interface AlbumFormDialogProps {
  /** 編輯的相簿；沒有是新增。 */
  album?: GalleryAlbum;
  onClose: () => void;
  onSaved?: (album: GalleryAlbum) => void;
}

/** 新增或改名相簿（名稱不分大小寫唯一；重複的錯誤顯示在表單裡）。 */
export function AlbumFormDialog({ album, onClose, onSaved }: AlbumFormDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(album?.name ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const create = useGalleryAlbumCreateMutation();
  const update = useGalleryAlbumUpdateMutation();
  const mutation = album ? update : create;

  const submit = async () => {
    const trimmed = name.trim();
    const body = { name: trimmed, description: description.trim() || null };
    const saved = album
      ? await update.mutateAsync({
          params: { albumId: album.id, body: { version: album.version, ...body } },
        })
      : await create.mutateAsync({ params: { body } });
    onSaved?.(saved);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={album ? t('gallery.album.edit.title') : t('gallery.album.create.title')}
      size="sm"
      data-testid="gallery-album-form"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={name.trim().length === 0}
            onClick={() => void submit().catch(() => undefined)}
            data-testid="gallery-album-form-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void submit().catch(() => undefined);
        }}
      >
        <Field label={t('gallery.album.name')}>
          <Input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            data-testid="gallery-album-form-name"
          />
        </Field>
        <Field label={t('gallery.album.description')}>
          <Input
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
            data-testid="gallery-album-form-description"
          />
        </Field>
        {mutation.error && <FormError>{errorMessage(mutation.error)}</FormError>}
      </form>
    </Dialog>
  );
}
