import type { RequestInterceptor } from '../../client';
import { useLocaleStore, useTimezoneStore } from '../../store';

/** 介面語系（`zh-TW`、`en-US`）：用標準標頭，後端的語系判斷不必認自訂名稱。 */
export const CLIENT_LOCALE_HEADER = 'accept-language';
/** 偏好的 IANA 時區（`Asia/Taipei`）；HTTP 沒有對應的標準標頭。 */
export const CLIENT_TIMEZONE_HEADER = 'x-client-timezone';

/**
 * 每個請求帶上使用者目前的介面語系與時區（偏好設定的 store，不是瀏覽器的預設）。
 * 送出當下才讀 store：切換語系、時區或其他分頁同步過來後，下一個請求就帶新值。
 * 只覆寫瀏覽器自動帶的 `Accept-Language`；呼叫端自己給的標頭以呼叫端為準。
 */
export const clientPreferenceInterceptor: RequestInterceptor = async (request) => {
  const headers = new Headers(request.init.headers);
  if (!headers.has(CLIENT_LOCALE_HEADER)) {
    headers.set(CLIENT_LOCALE_HEADER, useLocaleStore.getState().locale);
  }
  if (!headers.has(CLIENT_TIMEZONE_HEADER)) {
    headers.set(CLIENT_TIMEZONE_HEADER, useTimezoneStore.getState().timezone);
  }
  return { ...request, init: { ...request.init, headers } };
};
