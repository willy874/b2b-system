import type { ErrorCode } from '@b2b-system/error-codes';

import { AbortReason, NetworkError, RequestAbortedError } from '../client';
import { AppError } from '../errors';

export interface UploadProgress {
  loaded: number;
  total: number;
}

/** 直傳需要的最小資訊：api 回的上傳目標（檔案、分塊上傳的每一塊、圖片資產）都符合。 */
export interface StorageUploadTarget {
  url: string;
  method: 'PUT';
  headers: Readonly<Record<string, string>>;
}

export interface StorageUploadResult {
  /** 物件儲存回的 ETag（分塊上傳完成時要交回）；同源代理下瀏覽器讀得到，跨源時需要 CORS 的 ExposeHeaders。 */
  etag: string | undefined;
}

/**
 * 照後端給的 presigned 請求把內容直接送到物件儲存（檔案管理、圖片資產共用）。
 * 用 XHR 而不是 fetch：fetch 拿不到上傳進度。
 * 不經過 `HttpContext`：對象是物件儲存而不是 api，也不能帶 Authorization。
 */
export function putToStorage(
  target: StorageUploadTarget,
  body: Blob,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
    /** 物件儲存拒絕時的錯誤碼（預設檔案的 `FILE_UPLOAD_INCOMPLETE`）。 */
    incompleteCode?: ErrorCode;
  } = {},
): Promise<StorageUploadResult> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress, incompleteCode = 'FILE_UPLOAD_INCOMPLETE' } = options;
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
      else reject(new AppError(incompleteCode, xhr.status));
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
