/** 標題、內文的長度上限（純文字，docs/adr/0031-announcements.md）。 */
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;

/** 受眾每一種來源最多幾個（使用者、群組、角色各自計）。 */
export const ANNOUNCEMENT_AUDIENCE_MAX_PER_KIND = 200;

/** 分批寫入通知：每批一個交易（D9）。小於 `notify()` 單次上限 1000。 */
export const ANNOUNCEMENT_FAN_OUT_BATCH_SIZE = 500;

/** 收件人看全文的頁面的 route id（前端 `features/announcement` 登記；已發出的不改名，ADR-0026 D3）。 */
export const ANNOUNCEMENT_MESSAGE_ROUTE = 'announcement.message';
