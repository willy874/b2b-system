import { sessionStore } from '@/core/auth';
import type { RequestInterceptor } from '@/core/client';

/** 請求前確保 access token 新鮮（必要時跨分頁單飛續期），再加上 Authorization。 */
export const authHeaderInterceptor: RequestInterceptor = async (request) => {
  const token = await sessionStore.ensureAccessToken();
  if (!token) return request;
  const headers = new Headers(request.init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...request, init: { ...request.init, headers } };
};
