/** 打開命令面板的快捷鍵（macOS ⌘K、其他平台 Ctrl+K）。 */
export const COMMAND_PALETTE_HOTKEY = 'mod+k';

/** 每個資料提供者最多回傳幾筆：面板是用來「跳過去」，不是列表頁。 */
export const SEARCH_RESULT_LIMIT = 5;

/** 後端列表 API 的 `keyword` 上限（`z.string().max(100)`）；超過的部分不送出。 */
export const SEARCH_QUERY_MAX_LENGTH = 100;
