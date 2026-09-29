import { EventEmitter } from '@/shared/EventEmitter';

/**
 * 請求中止的原因。每個請求都有自己的 `AbortController`，下列來源任一觸發就中止：
 * - `caller`：呼叫端的 signal（TanStack Query 取消、元件卸載…）
 * - `timeout`：`HttpContextOptions.timeoutMs` 到期
 * - 其餘：由 `abortRequests()` 廣播（例如 session 結束時中止所有 `auth` 請求）
 */
export const AbortReason = {
  CALLER: 'caller',
  TIMEOUT: 'timeout',
  SESSION_ENDED: 'session-ended',
} as const;

export type AbortReason = (typeof AbortReason)[keyof typeof AbortReason];

/** 中止後 `HttpContext.request()` 一律以這個錯誤 reject，不外露 `DOMException`。 */
export class RequestAbortedError extends Error {
  constructor(
    readonly reason: AbortReason,
    readonly detail?: string,
  ) {
    super(`request aborted: ${reason}`);
    this.name = 'RequestAbortedError';
  }
}

export function isRequestAborted(error: unknown): error is RequestAbortedError {
  return error instanceof RequestAbortedError;
}

export interface RequestAbortEvent {
  reason: AbortReason;
  /** 只中止這些 `HttpContext` 的請求；省略代表全部。 */
  contexts?: readonly string[];
  /** 附帶說明（例：session 結束的原因碼），放進 `RequestAbortedError.detail`。 */
  detail?: string;
}

type RequestAbortEvents = {
  abort: (event: RequestAbortEvent) => void;
};

/** 每個進行中的請求都訂閱這條匯流排，結束時退訂。 */
export const requestAbortBus = new EventEmitter<RequestAbortEvents>();

/** 中止所有（或指定 context 的）進行中請求。 */
export function abortRequests(event: RequestAbortEvent): void {
  requestAbortBus.emit('abort', event);
}

/** signal 已中止時丟出它的 reason（`HttpContext` 放進去的一定是 `RequestAbortedError`）。 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw toAbortedError(signal);
}

/** 讓不認識 signal 的非同步工作（續期、等待其他分頁）可以被中止；工作本身不會被取消。 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(toAbortedError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(toAbortedError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** 可中止的等待（重試退避用）。 */
export function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delay = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return raceAbort(delay, signal).finally(() => clearTimeout(timer));
}

export function toAbortedError(signal: AbortSignal): RequestAbortedError {
  const reason: unknown = signal.reason;
  return reason instanceof RequestAbortedError
    ? reason
    : new RequestAbortedError(AbortReason.CALLER);
}
