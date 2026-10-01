/**
 * `notify()` 單次的收件人數上限（ADR-0026 D6）。第一批類型的收件人都不多（審核者、申請人、被指派的人）；
 * 超過代表需要廣播模型，先記 warn 並截斷，而不是讓業務寫入失敗。
 */
export const MAX_NOTIFICATION_RECIPIENTS = 1000;

/** 一筆通知的 `params` 序列化後的上限：只放名稱快照，超過代表呼叫端把整份資料塞進來了。 */
export const MAX_NOTIFICATION_PARAMS_BYTES = 4096;

/** `GET /notifications` 一頁的筆數上限與預設。 */
export const NOTIFICATION_PAGE_MAX = 100;
export const NOTIFICATION_PAGE_DEFAULT = 20;

/** 保留清理一批刪幾筆：一批一條 DELETE（各自提交）。 */
export const NOTIFICATION_CLEANUP_BATCH_SIZE = 1000;

/** `PATCH /notification-events` 一次最多改幾個「事件 ＋ 管道」（ADR-0028 D9）。 */
export const NOTIFICATION_EVENT_MAX_CHANGES = 100;
