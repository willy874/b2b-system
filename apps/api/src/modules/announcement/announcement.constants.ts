/** 標題、內文的長度上限（純文字，docs/architecture/backend/19-announcement.md §9）。 */
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;

/** 受眾每一種來源最多幾個（使用者、群組、角色各自計）。 */
export const ANNOUNCEMENT_AUDIENCE_MAX_PER_KIND = 200;

/** 分批寫入通知：每批一個交易（D9）。小於 `notify()` 單次上限 1000。 */
export const ANNOUNCEMENT_FAN_OUT_BATCH_SIZE = 500;

/** 收件人看全文的頁面的 route id（前端 `features/announcement` 登記；已發出的不改名，docs/architecture/backend/15-notification.md §12.2 D3）。 */
export const ANNOUNCEMENT_MESSAGE_ROUTE = 'announcement.message';

/** 週期的間隔上限：每 99 天／週／月。 */
export const ANNOUNCEMENT_RECURRENCE_MAX_INTERVAL = 99;

/** 週期預覽回幾次。 */
export const ANNOUNCEMENT_RECURRENCE_PREVIEW_COUNT = 5;

/** 每日維護：只補「下一次在這段時間內」的排程（再下一次維護之前會到的），避免每天替遠期的排程多排一筆。 */
export const ANNOUNCEMENT_REQUEUE_WINDOW_MS = 25 * 60 * 60 * 1000;

/** 事件點的延遲上限：30 天（分鐘）。 */
export const ANNOUNCEMENT_EVENT_MAX_DELAY_MINUTES = 30 * 24 * 60;
