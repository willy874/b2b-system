import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Popover } from '@b2b-system/ui/Popover';
import { Spinner } from '@b2b-system/ui/Spinner';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getGalleryUploadsQueryOptions } from '@/apis/gallery/get-gallery-uploads/query';

import { GALLERY_FAILURE_LABEL_KEY } from '../constants';
import { useGalleryClearFailedMutation } from '../hooks/useGalleryMutations';

/**
 * 頁首的「處理中 N 張」與處理失敗的清單（只有自己的；docs/architecture/frontend/24-gallery.md §4）：
 * 列表只出現處理完成的圖，上傳的人在這裡看到進度與失敗的原因。推播（處理完成、失敗）讓它重抓。
 */
export function GalleryUploadStatus() {
  const { t } = useTranslation();
  const uploads = useQuery(getGalleryUploadsQueryOptions());
  const clear = useGalleryClearFailedMutation();
  const processing = uploads.data?.processing ?? 0;
  const failed = uploads.data?.failed ?? [];
  if (processing === 0 && failed.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="gallery-upload-status">
      {processing > 0 && (
        <span
          className="flex items-center gap-1 text-[var(--color-fg-muted)]"
          data-testid="gallery-upload-processing"
          data-value={processing}
        >
          <Spinner size={14} label={t('gallery.upload.processing', { count: processing })} />
          {t('gallery.upload.processing', { count: processing })}
        </span>
      )}
      {failed.length > 0 && (
        <Popover
          trigger={
            <Button
              size="sm"
              variant="ghost"
              startIcon={<Icon name="warning" size={14} />}
              data-testid="gallery-upload-failed"
            >
              {t('gallery.upload.failed', { count: failed.length })}
            </Button>
          }
        >
          <div className="flex max-w-80 flex-col gap-2 text-sm">
            <ul className="m-0 max-h-60 list-disc overflow-auto pl-5">
              {failed.map((item) => (
                <li key={item.id} className="break-all">
                  {t('gallery.upload.failedRow', {
                    name: item.title,
                    reason: item.failureReason
                      ? t(GALLERY_FAILURE_LABEL_KEY[item.failureReason])
                      : t('gallery.failure.unknown'),
                  })}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              loading={clear.isPending}
              onClick={() => clear.mutate({ params: {} })}
              data-testid="gallery-upload-clear-failed"
            >
              {t('gallery.upload.clearFailed')}
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}
