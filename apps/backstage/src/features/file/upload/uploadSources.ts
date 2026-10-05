import { createBlobStore } from '@b2b-system/web-shared/storage';

/**
 * 排隊中的上傳檔案。佇列項目只帶 id（要能跨 worker、跨分頁傳遞），檔案本身放在這裡：
 * 本分頁的記憶體 ＋ IndexedDB——發起的分頁關掉後，接手的分頁仍讀得到（docs/architecture/frontend/12-file-manager.md §14）。
 */
export const uploadSources = createBlobStore('file-upload');

/** 分頁當掉沒來得及清掉的檔案，下次啟動時清除。 */
export const UPLOAD_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
