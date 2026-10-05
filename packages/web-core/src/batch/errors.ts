import {
  AbortReason,
  isNetworkError,
  isRequestAborted,
  NetworkError,
  RequestAbortedError,
} from '../client';
import { AppError } from '../errors';
import type { BatchItemError } from './types';

/** 執行端：把一筆失敗轉成可跨 worker 傳遞的資料。 */
export function serializeBatchError(error: unknown): BatchItemError {
  if (error instanceof AppError) {
    return {
      kind: 'app',
      code: error.code,
      status: error.status,
      details: error.details,
      requestId: error.requestId,
    };
  }
  if (isNetworkError(error)) return { kind: 'network' };
  if (isRequestAborted(error)) return { kind: 'aborted', reason: error.reason };
  // 操作直接把 signal 交給瀏覽器 API（例：fetch 分塊）時拿到的是原生的 AbortError
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'aborted', reason: AbortReason.CALLER };
  }
  return { kind: 'unknown' };
}

/** 畫面端：還原成原本的錯誤型別，才能沿用 `useErrorMessage()` 的翻譯規則。 */
export function toBatchErrorInstance(error: BatchItemError): unknown {
  switch (error.kind) {
    case 'app':
      return new AppError(error.code, error.status, error.details, error.requestId);
    case 'network':
      return new NetworkError(undefined);
    case 'aborted':
      return new RequestAbortedError(error.reason as AbortReason);
    default:
      return new Error('unknown');
  }
}

/** 已經不存在（被別人刪掉）的項目：重試也沒有意義，結束後一併移出選取。 */
export function isGoneError(error: BatchItemError): boolean {
  return error.kind === 'app' && error.code.endsWith('_NOT_FOUND');
}
