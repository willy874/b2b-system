import type { AppPluginFactory } from '@/core/app';
import { sessionStore } from '@/core/auth';
import { AbortReason, abortRequests, HttpContext, registerHttpContext } from '@/core/client';
import {
  apiAdapterInterceptor,
  authHeaderInterceptor,
  refreshTokenInterceptor,
  retryInterceptor,
} from '@/plugins/fetcher';
import { ENV } from '@/shared/constants';

/** 單一請求（含續期等待與重試）的上限：卡住的連線不該讓畫面永遠停在載入中。 */
const REQUEST_TIMEOUT_MS = 30_000;

const AUTH_CONTEXT = 'auth';

/**
 * 兩個管道：
 * - `base`：retry ＋ 錯誤轉換。給 /auth/login、/auth/refresh、/health
 * - `auth`：base ＋ ensureAccessToken ＋ 401 續期重放。其餘全部
 */
export function httpContextPlugin(): AppPluginFactory {
  return () => {
    const base = new HttpContext({
      name: 'base',
      baseUrl: ENV.API_BASE_URL,
      timeoutMs: REQUEST_TIMEOUT_MS,
      responseInterceptors: [apiAdapterInterceptor],
      errorInterceptors: [retryInterceptor],
    });

    const auth = new HttpContext({
      name: AUTH_CONTEXT,
      baseUrl: ENV.API_BASE_URL,
      timeoutMs: REQUEST_TIMEOUT_MS,
      requestInterceptors: [authHeaderInterceptor],
      responseInterceptors: [apiAdapterInterceptor],
      errorInterceptors: [refreshTokenInterceptor, retryInterceptor],
    });

    registerHttpContext(base);
    registerHttpContext(auth);

    // session 結束 → 中止所有帶身分的請求：回應已經沒有用，還會讓畫面在跳轉登入頁時冒出錯誤。
    // `base`（登入、續期）不受影響。
    const offSessionEnded = sessionStore.events.on('ended', (reason) => {
      abortRequests({
        reason: AbortReason.SESSION_ENDED,
        contexts: [AUTH_CONTEXT],
        detail: reason,
      });
    });

    return {
      name: 'http-context',
      attrs: { sessionStore },
      onDestroy: () => {
        offSessionEnded();
        sessionStore.destroy();
      },
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    sessionStore: typeof sessionStore;
  }
}
