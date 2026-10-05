import { createInstanceId } from '@b2b-system/web-shared/channel';

/**
 * 這個分頁的 instance id：每個 HTTP 請求以 `x-client-id` 帶上（plugins/fetcher/client-id.ts），
 * 伺服器放進推播的 `origin`，收到自己發起的變更時略過（mutation 已經在本地失效過）。
 *
 * 每次載入頁面重新產生、不持久化：它只用來去重，不代表身分，也不做任何授權判斷。
 */
export const CLIENT_ID = createInstanceId();
