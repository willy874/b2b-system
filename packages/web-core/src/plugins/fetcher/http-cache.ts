import type { SessionStore } from '../../auth';
import type { RequestInterceptor } from '../../client';

/**
 * 沒有 session 的時候不用瀏覽器的 HTTP 快取（docs/architecture/frontend/09-state-and-storage.md §4.2）：
 * 登出、被撤銷、續期失敗之後送出的請求（登入頁的公開端點、殘留的重抓）一律 `cache: 'no-store'`，
 * 回應不存進磁碟，也不拿上一個 session 存下來的回應來重新驗證。有 session 時依伺服器的 `Cache-Control`
 * 與呼叫端的 `HttpRequestDTO.cache`。
 */
export function createHttpCacheInterceptor(session: SessionStore): RequestInterceptor {
  return async (request) => {
    if (session.hasSession()) return request;
    return { ...request, init: { ...request.init, cache: 'no-store' } };
  };
}
