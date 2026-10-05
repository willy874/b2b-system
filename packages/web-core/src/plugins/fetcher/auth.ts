import type { SessionStore } from '../../auth';
import { raceAbort } from '../../client';
import type { FetcherRequest, RequestInterceptor } from '../../client';

const AUTHORIZATION = 'authorization';
const BEARER_PREFIX = 'Bearer ';

/**
 * 請求前確保 `session` 的 access token 新鮮（必要時跨分頁單飛續期），再加上 Authorization。
 * 續期是多個請求共用的，本請求被中止時只放棄等待，不取消續期本身。
 */
export function createAuthHeaderInterceptor(session: SessionStore): RequestInterceptor {
  return async (request) => {
    const token = await raceAbort(session.ensureAccessToken(), request.signal);
    if (!token) return request;
    const headers = new Headers(request.init.headers);
    headers.set(AUTHORIZATION, `${BEARER_PREFIX}${token}`);
    return { ...request, init: { ...request.init, headers } };
  };
}

/** 取出這個請求實際送出的 access token（沒有代表送出時沒有 session）。 */
export function sentAccessToken(request: FetcherRequest): string | undefined {
  const value = new Headers(request.init.headers).get(AUTHORIZATION);
  return value?.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length) : undefined;
}
