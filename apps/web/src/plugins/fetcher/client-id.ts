import type { RequestInterceptor } from '@/core/client';
import { CLIENT_ID } from '@/core/realtime';
import { CLIENT_ID_HEADER } from '@/shared/realtime';

/**
 * 每個請求帶上這個分頁的 instance id（`x-client-id`）。
 * 伺服器把它放進推播的 `origin`，發起寫入的分頁收到自己的變更時略過
 * （docs/architecture/frontend/11-realtime.md §4.1）。只用來去重，伺服器不拿它做任何授權判斷。
 */
export const clientIdInterceptor: RequestInterceptor = async (request) => {
  const headers = new Headers(request.init.headers);
  headers.set(CLIENT_ID_HEADER, CLIENT_ID);
  return { ...request, init: { ...request.init, headers } };
};
