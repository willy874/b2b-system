import type { AppPluginFactory } from '@/core/app';
import { ensureSessionStore, sessionStore } from '@/core/auth';
import type { SessionStore, SessionTokens } from '@/core/auth';
import {
  AbortReason,
  abortRequests,
  backendContextNames,
  HttpContext,
  MAIN_BACKEND,
  registerHttpContext,
} from '@/core/client';
import {
  apiAdapterInterceptor,
  createAuthHeaderInterceptor,
  createRefreshTokenInterceptor,
  retryInterceptor,
} from '@/plugins/fetcher';

/** 單一請求（含續期等待與重試）的上限：卡住的連線不該讓畫面永遠停在載入中。 */
const REQUEST_TIMEOUT_MS = 30_000;

/** 主 session 結束時，其他後端的 session 以這個原因一併結束。 */
const MAIN_SESSION_ENDED = 'main_session_ended';

export interface BackendOptions {
  /** 後端名稱：同時是 session 名稱與 `HttpContext` 名稱的前綴（`<name>:base` / `<name>:auth`）。 */
  name: string;
  baseUrl: string;
  /** 以 refresh token 換新的 access token。由 `main.tsx` 注入：plugin 不認識 `apis/`。 */
  refresh: () => Promise<SessionTokens>;
}

/**
 * 每個後端建立一個 session 與兩個管道，彼此獨立：
 * - `<name>:base`：retry ＋ 錯誤轉換。給登入、續期、公開端點
 * - `<name>:auth`：base ＋ 該後端 session 的 ensureAccessToken ＋ 401 續期重放
 *
 * 必須包含 `MAIN_BACKEND`：它的 session 決定整個 app 的登入狀態。
 */
export function httpContextPlugin(backends: readonly BackendOptions[]): AppPluginFactory {
  if (!backends.some((backend) => backend.name === MAIN_BACKEND)) {
    throw new Error(`httpContextPlugin 缺少主後端 "${MAIN_BACKEND}"`);
  }

  return () => {
    const sessions: SessionStore[] = [];
    const offs: (() => void)[] = [];

    for (const backend of backends) {
      const session = ensureSessionStore(backend.name);
      session.setRefreshFn(backend.refresh);
      sessions.push(session);

      const names = backendContextNames(backend.name);
      registerHttpContext(
        new HttpContext({
          name: names.base,
          baseUrl: backend.baseUrl,
          timeoutMs: REQUEST_TIMEOUT_MS,
          responseInterceptors: [apiAdapterInterceptor],
          errorInterceptors: [retryInterceptor],
        }),
      );
      registerHttpContext(
        new HttpContext({
          name: names.auth,
          baseUrl: backend.baseUrl,
          timeoutMs: REQUEST_TIMEOUT_MS,
          requestInterceptors: [createAuthHeaderInterceptor(session)],
          responseInterceptors: [apiAdapterInterceptor],
          errorInterceptors: [createRefreshTokenInterceptor(session), retryInterceptor],
        }),
      );

      // session 結束 → 只中止這個後端帶身分的請求：回應已經沒有用，還會讓畫面冒出錯誤。
      // 同一後端的 `base`（登入、續期）與其他後端都不受影響
      offs.push(
        session.events.on('ended', (reason) => {
          abortRequests({
            reason: AbortReason.SESSION_ENDED,
            contexts: [names.auth],
            detail: reason,
          });
        }),
      );
    }

    // 主 session 結束（登出、被撤銷）= 使用者離開 app：其他後端的 session 一併在前端結束。
    // 否則下一個在這台瀏覽器登入的人，會沿用上一個人在其他後端的 access token。
    // 結束後 `hasSession` 旗標為 false，也不會再拿殘留的 refresh cookie 自動續期
    offs.push(
      sessionStore.events.on('ended', () => {
        for (const session of sessions) {
          if (session !== sessionStore) session.endSession(MAIN_SESSION_ENDED);
        }
      }),
    );

    return {
      name: 'http-context',
      attrs: { sessionStore },
      onDestroy: () => {
        for (const off of offs) off();
        for (const session of sessions) session.destroy();
      },
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    sessionStore: typeof sessionStore;
  }
}
