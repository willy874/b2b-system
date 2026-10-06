import { sessionStore } from '@b2b-system/web-core/auth';
import { createBlobStore } from '@b2b-system/web-shared/storage';

/**
 * 排隊中的上傳檔案。佇列項目只帶 id（要能跨 worker、跨分頁傳遞），檔案本身放在這裡：
 * 本分頁的記憶體 ＋ IndexedDB——發起的分頁關掉後，接手的分頁仍讀得到（docs/architecture/frontend/12-file-manager.md §14）。
 */
export const uploadSources = createBlobStore('file-upload');

/** 分頁當掉沒來得及清掉的檔案，下次啟動時清除。 */
export const UPLOAD_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 主 session 結束時清掉所有排隊中的檔案（本分頁的記憶體與 IndexedDB）：批次佇列同時被清空（`batchQueuePlugin` 的 `reset`），
 * 這些檔案不會再上傳，而且是上一個人的檔案，不能留給下一個登入的人（docs/architecture/frontend/12-file-manager.md §14.4）。
 * 回傳解除訂閱的函式（給 plugin 的 `onDestroy`）。
 */
export function clearUploadSourcesOnSessionEnd(): () => void {
  return sessionStore.events.on('ended', () => {
    // 不等它完成；IndexedDB 的失敗由 BlobStore 吞掉（本分頁的記憶體已經清掉）
    void uploadSources.clear();
  });
}
