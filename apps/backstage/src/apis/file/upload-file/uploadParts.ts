import { isNetworkError, isRequestAborted } from '@/core/client';
import { isAppError } from '@/core/errors';
import type { FileMultipartUpload, FileUploadPart } from '@/shared/api-sdk';

import { putToStorage } from './putToStorage';
import type { UploadProgress } from './putToStorage';
import { fetchFileCreateUploadPartsMutation } from './steps';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface UploadPartsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  /** 同時上傳幾塊。預設 4：瀏覽器對同一個 host 的並行連線有上限，再多也只是排隊。 */
  concurrency?: number;
  /** 每一塊失敗後重試幾次（網路錯誤、物件儲存 5xx）。預設 3。 */
  retries?: number;
  /** 測試注入：重試前的等待。 */
  wait?: (ms: number) => Promise<void>;
}

/** 一次要幾塊的網址：邊傳邊要，網址不會在長時間的大檔上傳中途過期太多。 */
const URL_BATCH = 20;
/** 網址剩下不到這麼久就重新要，避免傳到一半過期。 */
const URL_EXPIRY_MARGIN_MS = 60_000;

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 值得重試的失敗：網路中斷、物件儲存暫時性錯誤。其他（被中止、4xx）重試也不會好。 */
function isRetryable(error: unknown): boolean {
  if (isRequestAborted(error)) return false;
  if (isNetworkError(error)) return true;
  return isAppError(error) && error.code === 'FILE_UPLOAD_INCOMPLETE' && error.status >= 500;
}

/**
 * 分塊上傳（docs/architecture/backend/09-file.md §5.2）：依後端給的切法把 `file` 切塊，
 * 邊要網址邊並行直傳，每一塊各自重試；回傳各塊的 ETag（依塊號排序），交給 `complete`。
 *
 * - 進度是所有塊已送出的位元組總和；重試的那一塊從 0 重新計算。
 * - 任一塊用盡重試就中止其他塊並拋出錯誤（由 `uploadFile()` 放棄這次上傳）。
 */
export async function uploadParts(
  target: { workspaceId: string; fileId: string },
  plan: FileMultipartUpload,
  file: Blob,
  options: UploadPartsOptions = {},
): Promise<UploadedPart[]> {
  const { onProgress, concurrency = 4, retries = 3, wait = defaultWait } = options;
  // 自己的 controller：一塊失敗時中止其他塊，外部的 signal 也轉進來
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const signal = controller.signal;

  const loaded = new Map<number, number>();
  const report = () => {
    let sum = 0;
    for (const value of loaded.values()) sum += value;
    onProgress?.({ loaded: sum, total: file.size });
  };

  const urls = new Map<number, FileUploadPart>();
  let urlsExpireAt = 0;
  let inflightUrlRequest: Promise<void> | undefined;
  const ensureUrl = async (partNumber: number): Promise<FileUploadPart> => {
    const cached = urls.get(partNumber);
    if (cached && Date.now() < urlsExpireAt - URL_EXPIRY_MARGIN_MS) return cached;
    // 同時缺網址的幾塊共用一次請求
    inflightUrlRequest ??= (async () => {
      const partNumbers = Array.from(
        { length: Math.min(URL_BATCH, plan.partCount - partNumber + 1) },
        (_, index) => partNumber + index,
      );
      const response = await fetchFileCreateUploadPartsMutation({
        params: { ...target, partNumbers },
        signal,
      });
      for (const part of response.parts) urls.set(part.partNumber, part);
      urlsExpireAt = Date.parse(response.expiresAt);
    })().finally(() => {
      inflightUrlRequest = undefined;
    });
    await inflightUrlRequest;
    const fresh = urls.get(partNumber);
    return fresh ?? ensureUrl(partNumber);
  };

  const uploadOne = async (partNumber: number): Promise<UploadedPart> => {
    const start = (partNumber - 1) * plan.partSize;
    const body = file.slice(start, Math.min(start + plan.partSize, file.size));
    for (let attempt = 0; ; attempt += 1) {
      try {
        const target = await ensureUrl(partNumber);
        const { etag } = await putToStorage(target, body, {
          signal,
          onProgress: (progress) => {
            loaded.set(partNumber, progress.loaded);
            report();
          },
        });
        loaded.set(partNumber, body.size);
        report();
        // 沒有 ETag 代表讀不到回應標頭（跨源又沒設 ExposeHeaders）：組不起來，視為上傳未完成
        if (!etag) throw new TypeError('分塊上傳讀不到 ETag，請確認物件儲存的 CORS ExposeHeaders');
        return { partNumber, etag };
      } catch (error) {
        loaded.set(partNumber, 0);
        report();
        if (attempt >= retries || !isRetryable(error) || signal.aborted) throw error;
        // 指數退避：暫時性的網路問題多半幾秒內恢復
        await wait(500 * 2 ** attempt);
      }
    }
  };

  const results: UploadedPart[] = [];
  let next = 1;
  const worker = async () => {
    while (next <= plan.partCount && !signal.aborted) {
      const partNumber = next;
      next += 1;
      results.push(await uploadOne(partNumber));
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, plan.partCount) }, () =>
        worker().catch((error: unknown) => {
          controller.abort();
          throw error;
        }),
      ),
    );
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  return results.toSorted((a, b) => a.partNumber - b.partNumber);
}
