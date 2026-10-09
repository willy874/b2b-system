import { useBatchQueue } from '@b2b-system/web-core/batch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useCallback } from 'react';

import { fetchGalleryItemQuery } from '@/apis/gallery/get-gallery-item/fetcher';
import type { GalleryItem } from '@/shared/api-sdk';

import { GALLERY_SCOPE, GalleryBatchOperation } from '../../batch';
import { GALLERY_DOWNLOAD_MAX } from '../../constants';

/** 觸發一次下載（簽好的網址帶 `Content-Disposition: attachment`）。 */
function triggerDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * 選取之後的批次動作（docs/architecture/frontend/24-gallery.md §5）：刪除送進全域批次佇列；
 * 下載在目前的分頁逐張觸發（瀏覽器只讓前景的分頁觸發下載，佇列可能在別的分頁執行；打包下載是第二批，後端 D8）。
 */
export function useGalleryActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const queue = useBatchQueue();

  const deleteItems = useCallback(
    (items: readonly GalleryItem[]) => {
      if (!queue) throw new Error('批次佇列尚未註冊（batchQueuePlugin）');
      queue.enqueue({
        operation: GalleryBatchOperation.DELETE,
        scope: GALLERY_SCOPE,
        items: items.map((item) => ({ id: item.id, label: item.title })),
      });
    },
    [queue],
  );

  const downloadItems = useCallback(
    async (items: readonly GalleryItem[]) => {
      const targets = items.slice(0, GALLERY_DOWNLOAD_MAX);
      if (items.length > GALLERY_DOWNLOAD_MAX) {
        toast.info(t('gallery.download.limited', { count: GALLERY_DOWNLOAD_MAX }));
      }
      for (const item of targets) {
        // oxlint-disable-next-line no-await-in-loop -- 一張一張觸發：同時觸發幾十個下載會被瀏覽器擋下
        const detail = await fetchGalleryItemQuery({ params: { itemId: item.id } });
        triggerDownload(detail.download.original);
      }
    },
    [t, toast],
  );

  return { deleteItems, downloadItems };
}
