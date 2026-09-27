import type { StoredFile } from '@/shared/api-sdk';

import { putToStorage } from './putToStorage';
import type { UploadProgress } from './putToStorage';
import { fetchFileCompleteUploadMutation, fetchFileCreateUploadMutation } from './steps';

export type { UploadProgress };

/** 瀏覽器沒給型別（例：沒有副檔名）時的預設值。 */
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

export interface UploadFileParams {
  file: Blob;
  /** 預設取 `File.name`；傳 `Blob` 時必填。 */
  name?: string;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * 上傳一個檔案，回傳已可使用的 `StoredFile`（`status: 'ready'`，帶 `url`）。
 * 內部依序：登記（POST /files）→ 直傳到物件儲存（presigned PUT）→ 完成（POST /files/:id/complete）。
 * 呼叫端不需要知道物件儲存的存在（docs/architecture/backend/09-file.md §5）。
 */
export async function uploadFile(
  params: UploadFileParams,
  signal?: AbortSignal,
): Promise<StoredFile> {
  const { file, onProgress } = params;
  const name = params.name ?? (file instanceof File ? file.name : undefined);
  if (!name) throw new TypeError('uploadFile：傳入 Blob 時必須指定 name');

  const { file: pending, upload } = await fetchFileCreateUploadMutation({
    params: { name, contentType: file.type || FALLBACK_CONTENT_TYPE, size: file.size },
    signal,
  });
  await putToStorage(upload, file, { signal, onProgress });
  return fetchFileCompleteUploadMutation({ params: { fileId: pending.id }, signal });
}
