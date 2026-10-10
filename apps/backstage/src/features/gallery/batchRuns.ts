import type { BatchRunContext } from '@b2b-system/web-core/batch';

import { getGalleryItemDeleteMutationOptions } from '@/apis/gallery/delete-gallery-item/mutation';
import { uploadGalleryItem } from '@/apis/gallery/upload-gallery-item/fetcher';
import { Resource } from '@/apis/resources';
import { getResourceTagsUpdateMutationOptions } from '@/apis/tag/update-resource-tags/mutation';
import { createUploadRunner, parsePairedItemId } from '@/core/upload';

import { galleryUploadSources } from './batch';

/**
 * 圖片庫批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入，上傳與 API 的程式不進首頁的初始載入
 * （docs/architecture/frontend/02-plugin-system.md §4.8）。
 */
const deleteItem = getGalleryItemDeleteMutationOptions().mutationFn;
const addTags = getResourceTagsUpdateMutationOptions().mutationFn;

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

/** 上傳一張排隊中的圖（`itemId` 是 `<暫存 key>@<相簿 id>`）；取檔、限流與暫存檔由 `core/upload` 的 runner 處理。 */
export const uploadRun = createUploadRunner({
  sources: galleryUploadSources,
  incompleteCode: 'GALLERY_UPLOAD_INCOMPLETE',
  upload: async (file, albumId, { signal, reportProgress, invalidate }) => {
    const size = await measure(file);
    await uploadGalleryItem({ file, albumId, ...size, onProgress: reportProgress }, signal);
    // 還沒處理完，不在圖片庫：只讓頁首的「處理中 N 張」更新；處理完伺服器推 create
    invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'update' }]);
  },
  onSettled: ({ invalidate }) =>
    invalidate([{ resource: Resource.FILE_STORAGE_USAGE, kind: 'update' }]),
});

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
  // 差異語意：只加這一個，後端在交易內讀出目前的標籤再加上，不會蓋掉同時在檢視器裡做的修改；已經有了就不寫入
  await addTags({
    params: { resourceType: 'galleryItem', resourceId: itemId, add: [tagId] },
    signal,
  });
  invalidate([{ resource: Resource.GALLERY_ITEM, kind: 'update', id: itemId }]);
}
