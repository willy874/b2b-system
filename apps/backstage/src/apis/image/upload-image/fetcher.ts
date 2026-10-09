import { putToStorage } from '@b2b-system/web-core/direct-upload';

import type { ImageAsset, ImageCrop } from '@/shared/api-sdk';

import { fetchImageCompleteUploadMutation, fetchImageCreateUploadMutation } from './steps';

export interface UploadImageInput {
  usage: string;
  file: Blob;
  name: string;
  contentType: string;
  crop?: ImageCrop;
  signal?: AbortSignal;
  /** 0～1。 */
  onProgress?: (ratio: number) => void;
}

/**
 * 上傳一張圖片（docs/architecture/backend/25-image.md §15.4）：登記 → 直傳到物件儲存（大小、型別簽進網址）→ 確認並排入處理。
 * 只有一張、要立刻看到結果：不經過全域批次佇列，進度直接顯示在對話框裡；取消（`signal`）就放棄這次上傳
 * （沒確認的資產由清理排程在 24 小時後刪除）。
 */
export async function uploadImage(input: UploadImageInput): Promise<ImageAsset> {
  const { signal } = input;
  const registered = await fetchImageCreateUploadMutation({
    params: {
      usage: input.usage,
      name: input.name,
      contentType: input.contentType,
      size: input.file.size,
    },
    signal,
  });
  await putToStorage(registered.upload, input.file, {
    signal,
    incompleteCode: 'IMAGE_UPLOAD_INCOMPLETE',
    onProgress: ({ loaded, total }) => input.onProgress?.(total > 0 ? loaded / total : 0),
  });
  return fetchImageCompleteUploadMutation({
    params: { id: registered.asset.id, body: input.crop ? { crop: input.crop } : {} },
    signal,
  });
}
