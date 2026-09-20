import { getHttpContext } from './HttpContext';
import type { HttpContext } from './HttpContext';
import type { FetcherResponse } from './types';

export type FetcherImpl<TRequest, TResponse> = (
  http: HttpContext,
  request: TRequest,
) => Promise<FetcherResponse<TResponse>>;

function define<TRequest, TResponse>(
  contextName: string,
  impl: FetcherImpl<TRequest, TResponse>,
): (request: TRequest) => Promise<TResponse> {
  return async (request: TRequest) => {
    const response = await impl(getHttpContext(contextName), request);
    return response.data;
  };
}

/**
 * `base`：只有 retry 與錯誤轉換。用於 `/auth/login`、`/auth/refresh`、`/health`。
 * 登入端點若用 auth 版會死結：它會先嘗試取得 access token（還沒有）→ 觸發續期
 * （沒有 refresh token）→ 失敗 → 登入永遠打不出去。
 */
export const defineBaseFetcher = <TRequest, TResponse>(impl: FetcherImpl<TRequest, TResponse>) =>
  define<TRequest, TResponse>('base', impl);

/** `auth`：base ＋ `ensureAccessToken` ＋ 401 續期重放。其餘端點全部用這個。 */
export const defineAuthFetcher = <TRequest, TResponse>(impl: FetcherImpl<TRequest, TResponse>) =>
  define<TRequest, TResponse>('auth', impl);
