import { abortableDelay, isNetworkError } from '@/core/client';
import type { ErrorInterceptor, FetcherRequest } from '@/core/client';
import { AppError } from '@/core/errors';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;

/**
 * 只有冪等的方法可以自動重試：伺服器可能已處理完才斷線，重送 POST 會重複建立資料；
 * `/auth/refresh` 重送會拿已輪替掉的 refresh token，被判定為重用而撤銷整個 session。
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isIdempotent(request: FetcherRequest): boolean {
  return IDEMPOTENT_METHODS.has((request.init.method ?? 'GET').toUpperCase());
}

/** 網路層錯誤與 5xx 才重試；4xx 是請求本身的問題，重試沒有意義。 */
function isRetryable(error: unknown, request: FetcherRequest): boolean {
  if (request.signal.aborted) return false;
  if (!isIdempotent(request)) return false;
  if (error instanceof AppError) return error.status >= 500;
  // 其餘（中止、程式錯誤）不重試
  return isNetworkError(error);
}

export const retryInterceptor: ErrorInterceptor = async (error, request, retry) => {
  if (!isRetryable(error, request)) throw error;

  let lastError = error;
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    // 被中止時直接丟出 RequestAbortedError，不再等、不再送
    await abortableDelay(BASE_DELAY_MS * 2 ** (attempt - 1), request.signal);
    try {
      return await retry();
    } catch (next) {
      lastError = next;
      if (!isRetryable(next, request)) throw next;
    }
  }
  throw lastError;
};
