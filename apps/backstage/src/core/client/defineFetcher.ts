import { backendContextNames, MAIN_BACKEND } from './backend';
import { getHttpContext } from './HttpContext';
import type { HttpClient } from './HttpContext';
import type { FetcherResponse } from './types';

export type FetcherImpl<TRequest, TResponse> = (
  http: HttpClient,
  request: TRequest,
) => Promise<FetcherResponse<TResponse>>;

/** `HttpRequestDTO.signal`；`void` 請求（例：refresh、logout）沒有。 */
function signalOf(request: unknown): AbortSignal | undefined {
  if (typeof request !== 'object' || request === null || !('signal' in request)) return undefined;
  return request.signal instanceof AbortSignal ? request.signal : undefined;
}

function define<TRequest, TResponse>(
  contextName: string,
  impl: FetcherImpl<TRequest, TResponse>,
): (request: TRequest) => Promise<TResponse> {
  return async (request: TRequest) => {
    // signal 在這裡統一接上，fetcher 實作漏傳也不會失去取消能力
    const http = getHttpContext(contextName).bind(signalOf(request));
    const response = await impl(http, request);
    return response.data;
  };
}

export interface BackendFetcherDefiners {
  /**
   * `base`：只有 retry 與錯誤轉換。用於登入、續期、公開端點。
   * 登入端點若用 auth 版會死結：它會先嘗試取得 access token（還沒有）→ 觸發續期
   * （沒有 refresh token）→ 失敗 → 登入永遠打不出去。
   */
  defineBaseFetcher: <TRequest, TResponse>(
    impl: FetcherImpl<TRequest, TResponse>,
  ) => (request: TRequest) => Promise<TResponse>;
  /** `auth`：base ＋ 該後端 session 的 `ensureAccessToken` ＋ 401 續期重放。 */
  defineAuthFetcher: <TRequest, TResponse>(
    impl: FetcherImpl<TRequest, TResponse>,
  ) => (request: TRequest) => Promise<TResponse>;
}

/** 某個後端的 fetcher 定義器。其他後端的 `apis/` 用這個，不要手寫 context 名稱。 */
export function defineBackendFetchers(backend: string): BackendFetcherDefiners {
  const names = backendContextNames(backend);
  return {
    defineBaseFetcher: (impl) => define(names.base, impl),
    defineAuthFetcher: (impl) => define(names.auth, impl),
  };
}

/** 主後端的定義器（`apis/` 底下現有的端點全部用這組）。 */
export const { defineBaseFetcher, defineAuthFetcher } = defineBackendFetchers(MAIN_BACKEND);
