import { putToStorage } from '@b2b-system/web-core/direct-upload';
import type { UploadProgress } from '@b2b-system/web-core/direct-upload';

import type { GalleryUploadItem } from '@/shared/api-sdk';

import { fetchGalleryCompleteUploadMutation, fetchGalleryCreateUploadMutation } from './steps';

export interface UploadGalleryItemInput {
  file: File;
  /** 瀏覽器量的尺寸（暫定值）；量不到就省略。 */
  width?: number;
  height?: number;
  albumId?: string;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * 上傳一張圖片庫的圖（docs/architecture/backend/26-gallery.md §4）：登記 → 單次 PUT 直傳物件儲存（大小、型別簽進網址）→
 * 確認並排入處理。不分塊（單檔上限 50 MiB）。中途失敗或取消不必另外放棄：沒完成的登記由清理排程在 24 小時後刪除。
 */
export async function uploadGalleryItem(
  input: UploadGalleryItemInput,
  signal?: AbortSignal,
): Promise<GalleryUploadItem> {
  const { file } = input;
  const registered = await fetchGalleryCreateUploadMutation({
    params: {
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      ...(input.width && input.height ? { width: input.width, height: input.height } : {}),
      ...(input.albumId ? { albumId: input.albumId } : {}),
    },
    signal,
  });
  await putToStorage(registered.upload, file, {
    signal,
    onProgress: input.onProgress,
    incompleteCode: 'GALLERY_UPLOAD_INCOMPLETE',
  });
  return fetchGalleryCompleteUploadMutation({ params: { id: registered.item.id }, signal });
}
