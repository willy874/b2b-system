import type { ErrorInterceptor } from '@/core/client';
import { AppError } from '@/core/errors';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 只重試網路層錯誤與 5xx；4xx 是請求本身的問題，重試沒有意義。 */
export const retryInterceptor: ErrorInterceptor = async (error, _request, retry) => {
  const retryable = !(error instanceof AppError) || error.status >= 500;
  if (!retryable) throw error;
  if (error instanceof DOMException && error.name === 'AbortError') throw error;

  let lastError = error;
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    try {
      return await retry();
    } catch (next) {
      lastError = next;
      if (next instanceof AppError && next.status < 500) throw next;
    }
  }
  throw lastError;
};
