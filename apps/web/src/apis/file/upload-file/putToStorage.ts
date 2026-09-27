import { AbortReason, NetworkError, RequestAbortedError } from '@/core/client';
import { AppError } from '@/core/errors';
import type { FileUploadTarget } from '@/shared/api-sdk';

export interface UploadProgress {
  loaded: number;
  total: number;
}

/** 直傳需要的最小資訊：分塊上傳的每一塊（`FileUploadPart`）也符合。 */
export type StorageUploadTarget = Pick<FileUploadTarget, 'url' | 'method' | 'headers'>;

export interface StorageUploadResult {
  /** 物件儲存回的 ETag（分塊上傳完成時要交回）；同源代理下瀏覽器讀得到，跨源時需要 CORS 的 ExposeHeaders。 */
  etag: string | undefined;
}

/**
 * 照後端給的 presigned 請求把內容直接送到物件儲存。
 * 用 XHR 而不是 fetch：fetch 拿不到上傳進度。
 * 不經過 `HttpContext`：對象是物件儲存而不是 api，也不能帶 Authorization。
 */
export function putToStorage(
  target: StorageUploadTarget,
  body: Blob,
  options: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void } = {},
): Promise<StorageUploadResult> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(new RequestAbortedError(AbortReason.CALLER));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    // 這些標頭已簽進網址，少帶或改值都會被拒
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        onProgress({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : body.size,
        });
      });
    }
    xhr.addEventListener('load', () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') ?? undefined });
      }
      // 物件儲存回的是 S3 的 XML 錯誤，前端不解析；對使用者而言就是「上傳沒完成」
      else reject(new AppError('FILE_UPLOAD_INCOMPLETE', xhr.status));
    });
    xhr.addEventListener('error', () => {
      cleanup();
      reject(new NetworkError(new Error('storage upload failed')));
    });
    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new RequestAbortedError(AbortReason.CALLER));
    });

    xhr.send(body);
  });
}
