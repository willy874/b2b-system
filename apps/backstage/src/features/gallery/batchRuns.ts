import type { BatchRunContext } from '@b2b-system/web-core/batch';
import { AppError, ErrorCodes, isAppError } from '@b2b-system/web-core/errors';

import { getGalleryItemDeleteMutationOptions } from '@/apis/gallery/delete-gallery-item/mutation';
import { fetchGalleryItemQuery } from '@/apis/gallery/get-gallery-item/fetcher';
import { uploadGalleryItem } from '@/apis/gallery/upload-gallery-item/fetcher';
import { Resource } from '@/apis/resources';
import { getResourceTagsReplaceMutationOptions } from '@/apis/tag/replace-resource-tags/mutation';

import { galleryUploadSources, parsePairedItemId } from './batch';

/**
 * 圖片庫批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入，上傳與 API 的程式不進首頁的初始載入
 * （docs/architecture/frontend/02-plugin-system.md §4.8）。
 */
const deleteItem = getGalleryItemDeleteMutationOptions().mutationFn;
const replaceTags = getResourceTagsReplaceMutationOptions().mutationFn;

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

export async function uploadRun(
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

export async function deleteRun(
  itemId: string,
  { signal, invalidate }: BatchRunContext,
): Promise<void> {
  await deleteItem({ params: { itemId }, signal });
  invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'delete', id: itemId }]);
}

export async function tagRun(
  pairId: string,
  { signal, invalidate }: BatchRunContext,
): Promise<void> {
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
}
