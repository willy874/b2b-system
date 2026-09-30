/**
 * 傳輸層失敗：請求沒有拿到任何 HTTP 回應（離線、DNS、CORS、連線中途斷掉）。
 * `fetch` 在這些情況丟的是沒有區別性的 `TypeError`，在 `HttpContext` 換成這個，
 * 讓重試與 UI 不必猜「這個 TypeError 是網路問題還是程式錯誤」。
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network error', { cause });
    this.name = 'NetworkError';
  }
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}
