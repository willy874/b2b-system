import { registerBatchOperation } from '@b2b-system/web-core/batch';
import type { BatchQueueClient } from '@b2b-system/web-core/batch';

import { createUploadSources, pairItemId } from '@/core/upload';

import { GALLERY_UPLOAD_CONCURRENCY } from './constants';
import { GALLERY_LOCALE_SCOPE } from './locale';

/** 圖片庫的批次操作 id（`BatchAction.operation`）。 */
export const GalleryBatchOperation = {
  UPLOAD: 'gallery.upload',
  DELETE: 'gallery.delete',
  /** 貼一個標籤（`itemId` 是 `<圖片 id>@<標籤 id>`）。 */
  TAG: 'gallery.tag',
} as const;

/** 圖片庫在佇列裡的識別（`BatchJob.scope`）。 */
export const GALLERY_SCOPE = 'gallery';

/**
 * 圖片庫的上傳暫存區（`core/upload`）。名稱 `gallery-upload` 是 IndexedDB 的名稱，上線後不能改。
 * 與檔案管理各自一個：任一個 feature 被關掉，另一個的排隊檔案不受影響。
 */
export const galleryUploadSources = createUploadSources('gallery-upload');

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

/**
 * 在 plugin 的同步階段呼叫，只登記 id 與名稱；實作在 `batchRuns.ts`。每一筆呼叫一次單筆 API、以 `invalidate` 宣告變更
 * （由佇列合併套用），結果由批次佇列在整批結束時彈出（docs/architecture/frontend/07-ui-system.md §13）。
 * 加入與移出相簿是一個請求（最多 500 張）、下載要在目前的分頁觸發，不經過佇列（docs/architecture/frontend/24-gallery.md §6）。
 */
export function registerGalleryBatchOperations(): void {
  registerBatchOperation({
    id: GalleryBatchOperation.UPLOAD,
    labelKey: 'gallery.batch.upload.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.upload.success',
    run: async (itemId, context) => (await runs()).uploadRun(itemId, context),
  });
  registerBatchOperation({
    id: GalleryBatchOperation.DELETE,
    labelKey: 'gallery.batch.delete.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.delete.success',
    run: async (itemId, context) => (await runs()).deleteRun(itemId, context),
  });
  registerBatchOperation({
    id: GalleryBatchOperation.TAG,
    labelKey: 'gallery.batch.tag.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.tag.success',
    run: async (pairId, context) => (await runs()).tagRun(pairId, context),
  });
}

export interface QueuedGalleryUpload {
  file: File;
  albumId?: string;
}

/** 把檔案送進全域佇列：先放進暫存區，佇列項目只帶 id（含目的地相簿）與顯示用的名稱、大小。回傳工作 id。 */
export async function enqueueGalleryUploads(
  queue: BatchQueueClient,
  uploads: readonly QueuedGalleryUpload[],
): Promise<string> {
  const items = await Promise.all(
    uploads.map(async ({ file, albumId }) => {
      const sourceKey = crypto.randomUUID();
      await galleryUploadSources.store.put(sourceKey, file);
      return { id: pairItemId(sourceKey, albumId), label: file.name, weight: file.size };
    }),
  );
  return queue.enqueue({
    operation: GalleryBatchOperation.UPLOAD,
    scope: GALLERY_SCOPE,
    items,
    concurrency: GALLERY_UPLOAD_CONCURRENCY,
  });
}
