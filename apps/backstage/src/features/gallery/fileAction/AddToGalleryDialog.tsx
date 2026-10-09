import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { FormError } from '@b2b-system/ui/FormError';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useState } from 'react';

import type { FileActionDialogProps } from '@/core/file';
import type { GalleryFromSourceResult } from '@/shared/api-sdk';

import { AlbumPicker, isAlbumChoiceValid } from '../components/AlbumPicker';
import type { AlbumChoice } from '../components/AlbumPicker';
import { GALLERY_SKIP_LABEL_KEY } from '../constants';
import { useGalleryFromSourceMutation } from '../hooks/useGalleryMutations';
import { useGalleryPermission } from '../hooks/useGalleryPermission';
import { useResolveAlbum } from '../hooks/useResolveAlbum';

interface SkippedRow {
  key: string;
  name: string;
  reason: string;
}

/**
 * 「加入圖片庫」（docs/architecture/frontend/24-gallery.md §6）：選相簿（可以新建）→ `POST /gallery/items/from-source` →
 * 結果：加入幾張、略過幾張與原因（檔案管理器的檢查略過的與後端略過的一起列）。
 * 加入的是 **複製**：之後刪除或搬移原檔，圖片庫的那幾張不受影響（後端 D2）。
 */
export function AddToGalleryDialog({ files, skipped, sourceId, onClose }: FileActionDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const permission = useGalleryPermission();
  const [album, setAlbum] = useState<AlbumChoice>({ kind: 'none' });
  const [result, setResult] = useState<GalleryFromSourceResult>();
  const [error, setError] = useState<unknown>();
  const add = useGalleryFromSourceMutation();
  const resolveAlbum = useResolveAlbum();
  const isPending = add.isPending || resolveAlbum.isPending;

  const submit = async () => {
    setError(undefined);
    try {
      const albumId = await resolveAlbum.resolve(album);
      const response = await add.mutateAsync({
        params: { body: { source: sourceId, refIds: files.map((file) => file.id), albumId } },
      });
      setResult(response);
    } catch (caught) {
      setError(caught);
    }
  };

  const nameOf = (refId: string) => files.find((file) => file.id === refId)?.name ?? refId;
  const skippedRows: SkippedRow[] = [
    ...skipped.map((entry) => ({
      key: entry.file.id,
      name: entry.file.name,
      reason: t(entry.reasonKey, entry.params),
    })),
    ...(result?.results ?? []).flatMap((entry) =>
      entry.status === 'skipped' && entry.reason
        ? [
            {
              key: entry.refId,
              name: entry.name ?? nameOf(entry.refId),
              reason: t(GALLERY_SKIP_LABEL_KEY[entry.reason]),
            },
          ]
        : [],
    ),
  ];
  const added = result?.results.filter((entry) => entry.status === 'added').length ?? 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('gallery.fileAction.title')}
      description={
        result ? undefined : t('gallery.fileAction.description', { count: files.length })
      }
      data-testid="gallery-add-from-file-dialog"
      footer={
        result ? (
          <div className="flex w-full items-center justify-between gap-2">
            <RouteLink
              to="gallery.home"
              className="text-sm"
              data-testid="gallery-add-from-file-open"
            >
              {t('gallery.fileAction.open')}
            </RouteLink>
            <Button onClick={onClose} data-testid="gallery-add-from-file-done">
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={isPending}
              disabled={!isAlbumChoiceValid(album)}
              onClick={() => void submit()}
              data-testid="gallery-add-from-file-submit"
            >
              {t('gallery.fileAction.submit', { count: files.length })}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="gallery-add-from-file-result">
          <p className="m-0" data-testid="gallery-add-from-file-added" data-value={added}>
            {t('gallery.fileAction.added', { count: added })}
          </p>
          {skippedRows.length > 0 && (
            <div>
              <p className="m-0 mb-1 text-[var(--color-fg-muted)]">
                {t('gallery.fileAction.skipped', { count: skippedRows.length })}
              </p>
              <ul
                className="m-0 max-h-48 list-disc overflow-auto pl-5"
                data-testid="gallery-add-from-file-skipped"
              >
                {skippedRows.map((row) => (
                  <li key={row.key} className="break-all">
                    {t('gallery.fileAction.skippedRow', { name: row.name, reason: row.reason })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {added > 0 && (
            <p className="m-0 text-[var(--color-fg-muted)]">
              {t('gallery.fileAction.processingHint')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {skipped.length > 0 && (
            <p className="m-0 text-sm text-[var(--color-fg-muted)]">
              {t('gallery.fileAction.willSkip', { count: skipped.length })}
            </p>
          )}
          <AlbumPicker
            value={album}
            onChange={setAlbum}
            canCreate={permission.canCreate}
            disabled={isPending}
          />
          {error !== undefined && <FormError>{errorMessage(error)}</FormError>}
        </div>
      )}
    </Dialog>
  );
}
