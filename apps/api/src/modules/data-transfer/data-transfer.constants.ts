/** 匯入匯出的固定上限（docs/architecture/backend/22-data-transfer.md §10）；可由平台調整的在 feature 參數。 */

/** 勾選範圍的 id 數，與前端的 `BATCH_SELECT_ALL_MAX` 一致。 */
export const DATA_TRANSFER_MAX_IDS = 10_000;
/** 每人同時進行（queued、running、applying）的傳輸。 */
export const DATA_TRANSFER_MAX_ACTIVE_PER_USER = 3;
/** `validate` 一次的列數。 */
export const DATA_TRANSFER_VALIDATE_MAX_ROWS = 1000;
/** 傳輸紀錄（摘要）的保留：過期後連同紀錄刪除。 */
export const DATA_TRANSFER_SUMMARY_RETENTION_DAYS = 90;
/** exporter 每頁讀的列數。 */
export const DATA_TRANSFER_EXPORT_PAGE_SIZE = 500;
/** 匯出檔每累積這麼多就以伺服器端的 multipart 上傳一段（S3 每段至少 5 MiB）。 */
export const DATA_TRANSFER_EXPORT_PART_BYTES = 8 * 1024 * 1024;
/** 進度更新與取消檢查的間隔（列數、毫秒；取較慢者）；也是推播的節流。 */
export const DATA_TRANSFER_PROGRESS_ROWS = 500;
export const DATA_TRANSFER_PROGRESS_INTERVAL_MS = 1000;
/** 套用時交易後副作用的合併間隔（列數、毫秒；先到者）。 */
export const DATA_TRANSFER_EFFECT_FLUSH_ROWS = 100;
export const DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS = 2000;
/** 套用途中每處理這麼多列重新檢查一次建立者的權限。 */
export const DATA_TRANSFER_RECHECK_ROWS = 100;
/** 分析的 worker thread 都在忙時排隊的上限。 */
export const DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS = 5000;
/** 分析回應的對應步驟附上的樣本列數。 */
export const DATA_TRANSFER_SAMPLE_ROWS = 5;
/** 修改模式範本抽樣的現有紀錄數。 */
export const DATA_TRANSFER_TEMPLATE_SAMPLES = 10;
/** 欄位說明列出選項的上限（超過不列）。 */
export const DATA_TRANSFER_HINT_MAX_OPTIONS = 12;
/** XLSX 單一儲存格的字元上限（超長截斷並加 `…`）。 */
export const XLSX_MAX_CELL_LENGTH = 32_767;
/** 多值欄位的分隔字元。 */
export const MULTI_VALUE_SEPARATOR = ';';
/** 修改模式中代表「清空」的寫法。 */
export const NULL_TOKEN = '\\N';
/** 參照的下拉選單一次回傳的筆數。 */
export const REFERENCE_SEARCH_LIMIT = 20;
