import { sessionStore } from '@b2b-system/web-core/auth';
import { createBlobStore } from '@b2b-system/web-shared/storage';
import type { BlobStore, BlobStoreOptions } from '@b2b-system/web-shared/storage';

/** 分頁當掉沒來得及清掉的檔案，下次啟動時清除。 */
export const UPLOAD_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 一個 feature 自己的上傳暫存區（`createUploadSources()`）。 */
export interface UploadSources {
  /**
   * 排隊中的上傳檔案。批次佇列的項目只帶 id（要能跨 worker、跨分頁傳遞），檔案本身放在這裡：
   * 本分頁的記憶體 ＋ IndexedDB——發起的分頁關掉後，接手的分頁仍讀得到（docs/architecture/frontend/12-file-manager.md §14）。
   */
  store: BlobStore;
  /** 清掉放進來超過 `UPLOAD_SOURCE_MAX_AGE_MS` 的檔案（給 plugin 的 `onInit`；失敗由 BlobStore 吞掉）。 */
  prune: () => Promise<void>;
  /**
   * 主 session 結束時清掉所有排隊中的檔案（本分頁的記憶體與 IndexedDB）：批次佇列同時被清空（`batchQueuePlugin` 的 `reset`），
   * 這些檔案不會再上傳，而且是上一個人的檔案，不能留給下一個登入的人（docs/architecture/frontend/12-file-manager.md §14.4）。
   * 回傳解除訂閱的函式（給 plugin 的 `onDestroy`）。
   */
  clearOnSessionEnd: () => () => void;
}

/**
 * 建立一個上傳暫存區。每個會上傳的 feature 各自建立一個（`name` 是 IndexedDB 的名稱，上線後不能改：
 * 改名會讓已經暫存的檔案再也讀不到），在 plugin 的 `onInit` 呼叫 `prune()` 與 `clearOnSessionEnd()`、`onDestroy` 解除。
 *
 * @param options 測試用（例：指定 `indexedDB`、`now`）。
 */
export function createUploadSources(name: string, options?: BlobStoreOptions): UploadSources {
  const store = createBlobStore(name, options);
  return {
    store,
    prune: () => store.prune(UPLOAD_SOURCE_MAX_AGE_MS),
    clearOnSessionEnd: () =>
      sessionStore.events.on('ended', () => {
        // 不等它完成；IndexedDB 的失敗由 BlobStore 吞掉（本分頁的記憶體已經清掉）
        void store.clear();
      }),
  };
}
