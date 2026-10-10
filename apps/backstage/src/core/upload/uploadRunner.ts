import type { BatchRunContext } from '@b2b-system/web-core/batch';
import { AppError, ErrorCodes, isAppError } from '@b2b-system/web-core/errors';

import { parsePairedItemId } from './pairedItemId';
import type { UploadSources } from './uploadSources';

export interface UploadRunnerOptions {
  /** 這個 feature 的上傳暫存區（`createUploadSources`）；項目 id 的第一段是暫存 key。 */
  sources: UploadSources;
  /** 拿不到暫存檔時的錯誤碼（例：`FILE_UPLOAD_INCOMPLETE`）。 */
  incompleteCode: string;
  /** 上傳一個檔案；`target` 是項目 id 的第二段（目的地資料夾、相簿），成功後以 `context.invalidate` 宣告變更。 */
  upload: (file: File, target: string | undefined, context: BatchRunContext) => Promise<void>;
  /**
   * 每一筆結束（成功、失敗、取消）之後：登記就佔用了容量，失敗與取消的上傳也要到永久刪除才釋出，
   * 所以一律重抓已用量（`core/` 不認識 `apis/` 的資源，由 feature 傳入）。
   */
  onSettled: (context: BatchRunContext) => void;
}

/**
 * 批次上傳一筆的共同流程（檔案管理、圖片庫）：從暫存區取檔 → 取不到就請使用者重傳 → 上傳 →
 * 被限流時保留暫存檔讓佇列稍後重送，其他情況（成功或失敗）都刪掉暫存檔。回傳給 `registerBatchOperation` 的 `run`。
 */
export function createUploadRunner({
  sources,
  incompleteCode,
  upload,
  onSettled,
}: UploadRunnerOptions): (itemId: string, context: BatchRunContext) => Promise<void> {
  return async (itemId, context) => {
    const { first: sourceKey, second: target } = parsePairedItemId(itemId);
    const source = await sources.store.get(sourceKey);
    // 發起的分頁關掉、而這台瀏覽器的 IndexedDB 不可用：接手的分頁拿不到檔案，只能請使用者重傳
    if (!(source instanceof File)) {
      throw new AppError(incompleteCode, 0, { reason: 'source-unavailable' });
    }
    let willRetry = false;
    try {
      await upload(source, target, context);
    } catch (error) {
      // 被限流的那一筆由佇列在時間到後重送（docs/architecture/frontend/07-ui-system.md §13.4）：檔案要留著
      willRetry = isAppError(error) && error.code === ErrorCodes.RATE_LIMITED;
      throw error;
    } finally {
      onSettled(context);
      // 其餘情況都不會再用到（佇列只重送被限流的；其他失敗由使用者重新選檔）
      if (!willRetry) await sources.store.delete(sourceKey);
    }
  };
}
