import { registerBatchOperation } from '@b2b-system/web-core/batch';
import type { BatchQueueClient, BatchRunContext } from '@b2b-system/web-core/batch';
import { AppError, ErrorCodes, isAppError } from '@b2b-system/web-core/errors';

import { getGalleryItemDeleteMutationOptions } from '@/apis/gallery/delete-gallery-item/mutation';
import { fetchGalleryItemQuery } from '@/apis/gallery/get-gallery-item/fetcher';
import { uploadGalleryItem } from '@/apis/gallery/upload-gallery-item/fetcher';
import { Resource } from '@/apis/resources';
import { getResourceTagsReplaceMutationOptions } from '@/apis/tag/replace-resource-tags/mutation';
import { createUploadSources } from '@/core/upload';

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

/**
 * 項目 id 帶上第二個值（上傳的目的地相簿、要貼的標籤）：佇列項目只能帶 id（要能跨 worker、跨分頁傳遞），
 * 接手的分頁也知道要做什麼。uuid 裡沒有 `@`。
 */
const SEPARATOR = '@';

export function pairedItemId(first: string, second: string | undefined): string {
  return second ? `${first}${SEPARATOR}${second}` : first;
}

export function parsePairedItemId(itemId: string): { first: string; second?: string } {
  const [first = itemId, second] = itemId.split(SEPARATOR);
  return second ? { first, second } : { first };
}

/** 瀏覽器量的尺寸（給時間軸先排版的暫定值）；量不到（格式不支援、jsdom）就不帶。 */
async function measure(file: File): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // 量不到不影響上傳：處理時以伺服器解碼的尺寸為準
    return undefined;
  }
}

async function runUpload(
  itemId: string,
  { signal, reportProgress, invalidate }: BatchRunContext,
): Promise<void> {
  const { first: sourceKey, second: albumId } = parsePairedItemId(itemId);
  const source = await galleryUploadSources.store.get(sourceKey);
  // 發起的分頁關掉、而這台瀏覽器的 IndexedDB 不可用：接手的分頁拿不到檔案，只能請使用者重傳
  if (!(source instanceof File)) {
    throw new AppError('GALLERY_UPLOAD_INCOMPLETE', 0, { reason: 'source-unavailable' });
  }
  let willRetry = false;
  try {
    const size = await measure(source);
    await uploadGalleryItem({ file: source, albumId, ...size, onProgress: reportProgress }, signal);
    // 還沒處理完，不在圖片庫：只讓頁首的「處理中 N 張」更新；處理完伺服器推 create
    invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'update' }]);
  } catch (error) {
    // 被限流的那一筆由佇列在時間到後重送：檔案要留著
    willRetry = isAppError(error) && error.code === ErrorCodes.RATE_LIMITED;
    throw error;
  } finally {
    invalidate([{ resource: Resource.FILE_STORAGE_USAGE, kind: 'update' }]);
    if (!willRetry) await galleryUploadSources.store.delete(sourceKey);
  }
}

const deleteItem = getGalleryItemDeleteMutationOptions().mutationFn;
const replaceTags = getResourceTagsReplaceMutationOptions().mutationFn;

/**
 * 在 plugin 的同步階段呼叫。每一筆呼叫一次單筆 API、以 `invalidate` 宣告變更（由佇列合併套用），
 * 結果由批次佇列在整批結束時彈出（docs/architecture/frontend/07-ui-system.md §13）。
 * 加入與移出相簿是一個請求（最多 500 張）、下載要在目前的分頁觸發，不經過佇列（docs/architecture/frontend/24-gallery.md §6）。
 */
export function registerGalleryBatchOperations(): void {
  registerBatchOperation({
    id: GalleryBatchOperation.UPLOAD,
    labelKey: 'gallery.batch.upload.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.upload.success',
    run: runUpload,
  });
  registerBatchOperation({
    id: GalleryBatchOperation.DELETE,
    labelKey: 'gallery.batch.delete.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.delete.success',
    run: async (itemId, { signal, invalidate }) => {
      await deleteItem({ params: { itemId }, signal });
      invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'delete', id: itemId }]);
    },
  });
  registerBatchOperation({
    id: GalleryBatchOperation.TAG,
    labelKey: 'gallery.batch.tag.title',
    localeScope: GALLERY_LOCALE_SCOPE,
    successKey: 'gallery.batch.tag.success',
    run: async (pairId, { signal, invalidate }) => {
      const { first: itemId, second: tagId } = parsePairedItemId(pairId);
      if (!tagId) return;
      // 讀目前的標籤再加上這一個（取代式的 API）：列表裡的可能已經過時
      const item = await fetchGalleryItemQuery({ params: { itemId }, signal });
      const tagIds = item.tags.map((tag) => tag.id);
      if (tagIds.includes(tagId)) return;
      await replaceTags({
        params: { resourceType: 'galleryItem', resourceId: itemId, tagIds: [...tagIds, tagId] },
        signal,
      });
      invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'update', id: itemId }]);
    },
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
      return { id: pairedItemId(sourceKey, albumId), label: file.name, weight: file.size };
    }),
  );
  return queue.enqueue({
    operation: GalleryBatchOperation.UPLOAD,
    scope: GALLERY_SCOPE,
    items,
    concurrency: GALLERY_UPLOAD_CONCURRENCY,
  });
}
