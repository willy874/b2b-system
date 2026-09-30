import type { CreateFileUploadRequest, StoredFile } from '@/shared/api-sdk';

import { putToStorage } from './putToStorage';
import type { UploadProgress } from './putToStorage';
import {
  fetchFileAbortUploadMutation,
  fetchFileCompleteUploadMutation,
  fetchFileCreateUploadMutation,
  fetchFileUploadStatusQuery,
} from './steps';
import { uploadParts } from './uploadParts';

export type { UploadProgress };

type ThumbnailContentType = NonNullable<CreateFileUploadRequest['thumbnail']>['contentType'];

/** 後端接受的縮圖型別（`THUMBNAIL_CONTENT_TYPES`）；其他型別的縮圖不送，當作沒有縮圖。 */
const THUMBNAIL_CONTENT_TYPES: readonly string[] = [
  'image/webp',
  'image/jpeg',
  'image/png',
] satisfies ThumbnailContentType[];

function isThumbnailContentType(value: string): value is ThumbnailContentType {
  return THUMBNAIL_CONTENT_TYPES.includes(value);
}

/** 瀏覽器沒給型別（例：沒有副檔名）時的預設值。 */
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

export interface UploadFileParams {
  file: Blob;
  /** 預設取 `File.name`；傳 `Blob` 時必填。 */
  name?: string;
  /** 放進哪個資料夾；不帶或 null 是根目錄。 */
  folderId?: string | null;
  /** 瀏覽器產生的縮圖（`core/file` 的縮圖產生器）；上傳失敗不影響檔案本身。 */
  thumbnail?: Blob;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * 上傳一個檔案，回傳已可使用的 `StoredFile`（`status: 'ready'`，帶 `url`）。
 * 內部依序：登記（POST /files）→ 直傳到物件儲存 → 完成（POST /files/:id/complete）。
 * 大檔由後端決定改成分塊上傳（`uploadParts`），呼叫端不需要分辨（docs/architecture/backend/09-file.md §5）。
 *
 * 登記之後任何一步失敗或被中止，都會放棄這次上傳（DELETE /files/:id/upload），不留下 pending 紀錄與分塊。
 */
export async function uploadFile(
  params: UploadFileParams,
  signal?: AbortSignal,
): Promise<StoredFile> {
  const { file, onProgress } = params;
  const thumbnail =
    params.thumbnail && isThumbnailContentType(params.thumbnail.type)
      ? params.thumbnail
      : undefined;
  const thumbnailType = thumbnail?.type;
  const name = params.name ?? (file instanceof File ? file.name : undefined);
  if (!name) throw new TypeError('uploadFile：傳入 Blob 時必須指定 name');

  const registered = await fetchFileCreateUploadMutation({
    params: {
      name,
      contentType: file.type || FALLBACK_CONTENT_TYPE,
      size: file.size,
      ...(params.folderId && { folderId: params.folderId }),
      ...(thumbnail &&
        thumbnailType &&
        isThumbnailContentType(thumbnailType) && {
          thumbnail: { contentType: thumbnailType, size: thumbnail.size },
        }),
    },
    signal,
  });
  const fileId = registered.file.id;
  let isCompleting = false;

  try {
    // 縮圖與本體並行；縮圖失敗只是沒有預覽，不讓上傳失敗
    const thumbnailDone =
      thumbnail && registered.thumbnailUpload
        ? putToStorage(registered.thumbnailUpload, thumbnail, { signal }).catch(() => undefined)
        : undefined;

    let parts: Awaited<ReturnType<typeof uploadParts>> | undefined;
    if (registered.multipart) {
      parts = await uploadParts(fileId, registered.multipart, file, { signal, onProgress });
    } else if (registered.upload) {
      await putToStorage(registered.upload, file, { signal, onProgress });
    }
    await thumbnailDone;

    isCompleting = true;
    return await fetchFileCompleteUploadMutation({
      params: { fileId, body: parts ? { parts } : undefined },
      signal,
    });
  } catch (error) {
    // `complete` 在伺服器端成功、回應卻遺失（網路中斷、逾時）：放棄會失敗，使用者重傳則多一個同名檔。
    // 先確認狀態，已經 ready 就當作成功（EDGE-22）
    if (isCompleting && !signal?.aborted) {
      const current = await fetchFileUploadStatusQuery({ params: { fileId } }).catch(
        () => undefined,
      );
      if (current?.status === 'ready') return current;
    }
    // 不用傳進來的 signal：被中止時它已經 aborted，清理請求也會被取消
    void fetchFileAbortUploadMutation({ params: { fileId } }).catch(() => undefined);
    throw error;
  }
}
