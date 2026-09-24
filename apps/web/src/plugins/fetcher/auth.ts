import { sessionStore } from '@/core/auth';
import { raceAbort } from '@/core/client';
import type { FetcherRequest, RequestInterceptor } from '@/core/client';

const AUTHORIZATION = 'authorization';
const BEARER_PREFIX = 'Bearer ';

/**
 * 請求前確保 access token 新鮮（必要時跨分頁單飛續期），再加上 Authorization。
 * 續期是多個請求共用的，本請求被中止時只放棄等待，不取消續期本身。
 */
export const authHeaderInterceptor: RequestInterceptor = async (request) => {
  const token = await raceAbort(sessionStore.ensureAccessToken(), request.signal);
  if (!token) return request;
  const headers = new Headers(request.init.headers);
  headers.set(AUTHORIZATION, `${BEARER_PREFIX}${token}`);
  return { ...request, init: { ...request.init, headers } };
};

/** 取出這個請求實際送出的 access token（沒有代表送出時沒有 session）。 */
export function sentAccessToken(request: FetcherRequest): string | undefined {
  const value = new Headers(request.init.headers).get(AUTHORIZATION);
  return value?.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length) : undefined;
}
