import type { AppPluginFactory } from '@/core/app';
import { sessionStore } from '@/core/auth';
import { HttpContext, registerHttpContext } from '@/core/client';
import {
  apiAdapterInterceptor,
  authHeaderInterceptor,
  refreshTokenInterceptor,
  retryInterceptor,
} from '@/plugins/fetcher';
import { ENV } from '@/shared/constants';

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
      responseInterceptors: [apiAdapterInterceptor],
      errorInterceptors: [retryInterceptor],
    });

    const auth = new HttpContext({
      name: 'auth',
      baseUrl: ENV.API_BASE_URL,
      requestInterceptors: [authHeaderInterceptor],
      responseInterceptors: [apiAdapterInterceptor],
      errorInterceptors: [refreshTokenInterceptor, retryInterceptor],
    });

    registerHttpContext(base);
    registerHttpContext(auth);

    return {
      name: 'http-context',
      attrs: { sessionStore },
      onDestroy: () => sessionStore.destroy(),
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    sessionStore: typeof sessionStore;
  }
}
