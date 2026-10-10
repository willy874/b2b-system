import { useBatchQueue } from '@b2b-system/web-core/batch';
import { downloadSequentially } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useCallback } from 'react';

import { fetchGalleryItemQuery } from '@/apis/gallery/get-gallery-item/fetcher';
import type { GalleryItem } from '@/shared/api-sdk';

import { GALLERY_SCOPE, GalleryBatchOperation } from '../../batch';
import { GALLERY_DOWNLOAD_MAX } from '../../constants';

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
      await downloadSequentially(items, {
        max: GALLERY_DOWNLOAD_MAX,
        resolve: async (item) => {
          const detail = await fetchGalleryItemQuery({ params: { itemId: item.id } });
          return { url: detail.download.original, fileName: '' };
        },
        onLimited: (max) => toast.info(t('gallery.download.limited', { count: max })),
      });
    },
    [t, toast],
  );

  return { deleteItems, downloadItems };
}
