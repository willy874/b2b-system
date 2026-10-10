import { registerBatchOperation } from '@b2b-system/web-core/batch';
import type { BatchQueueClient } from '@b2b-system/web-core/batch';

import { UPLOAD_CONCURRENCY } from './constants';
import { FILE_LOCALE_SCOPE } from './locale';
import { uploadSources } from './upload/uploadSources';

/** 檔案的批次操作 id（`BatchAction.operation`、`enqueueFileUploads`）。 */
export const FileBatchOperation = {
  UPLOAD: 'file.upload',
  DELETE: 'file.delete',
  /** 遞迴刪除資料夾（`itemId` 是資料夾 id）。 */
  DELETE_FOLDER: 'file.deleteFolder',
} as const;

/** 檔案管理器在佇列裡的識別（`BatchJob.scope`）：主區塊以它找出自己送出的工作。 */
export const FILE_MANAGER_SCOPE = 'file-manager';

/**
 * 上傳項目的 id：`<暫存檔的 key>` 或 `<暫存檔的 key>@<資料夾 id>`。
 * 佇列項目只能帶 id（要能跨 worker、跨分頁傳遞），目的地資料夾就編進 id 裡，接手的分頁也知道要傳到哪裡。
 */
const FOLDER_SEPARATOR = '@';

export function uploadItemId(sourceKey: string, folderId: string | null | undefined): string {
  return folderId ? `${sourceKey}${FOLDER_SEPARATOR}${folderId}` : sourceKey;
}

export function parseUploadItemId(itemId: string): { sourceKey: string; folderId?: string } {
  const [sourceKey = itemId, folderId] = itemId.split(FOLDER_SEPARATOR);
  return folderId ? { sourceKey, folderId } : { sourceKey };
}

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

/**
 * 在 plugin 的同步階段呼叫，只登記 id 與名稱；實作在 `batchRuns.ts`。每一筆呼叫一次單筆 API、以 `invalidate` 宣告變更
 * （同單筆 mutation hook，由佇列合併套用），不發 toast：結果由批次佇列在整批結束時彈出（docs/architecture/frontend/07-ui-system.md §13）。
 * 上傳在全域佇列裡與其他批次工作共用排程、進度、取消與結果彈窗（docs/architecture/frontend/12-file-manager.md §14）。
 */
export function registerFileBatchOperations(): void {
  registerBatchOperation({
    id: FileBatchOperation.UPLOAD,
    labelKey: 'file.batch.upload.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.upload.success',
    run: async (itemId, context) => (await runs()).uploadRun(itemId, context),
  });
  registerBatchOperation({
    id: FileBatchOperation.DELETE,
    labelKey: 'file.batch.delete.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.delete.success',
    run: async (fileId, context) => (await runs()).deleteFileRun(fileId, context),
  });
  registerBatchOperation({
    id: FileBatchOperation.DELETE_FOLDER,
    labelKey: 'file.batch.deleteFolder.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.deleteFolder.success',
    run: async (folderId, context) => (await runs()).deleteFolderRun(folderId, context),
  });
}

/** 要上傳的一個檔案與它的目的地。 */
export interface QueuedUpload {
  file: File;
  /** 目的地資料夾；省略是根目錄。 */
  folderId?: string;
  /** 結果清單上顯示的名稱；上傳資料夾時帶相對路徑（`素材/ui/button.png`），預設是檔名。 */
  label?: string;
}

/**
 * 把檔案送進全域佇列：先放進 `uploadSources`，佇列項目只帶 id（含目的地資料夾）與顯示用的名稱、大小。
 * 回傳工作 id。
 */
export async function enqueueFileUploads(
  queue: BatchQueueClient,
  uploads: readonly QueuedUpload[],
): Promise<string> {
  const items = await Promise.all(
    uploads.map(async ({ file, folderId, label }) => {
      const sourceKey = crypto.randomUUID();
      await uploadSources.put(sourceKey, file);
      return {
        id: uploadItemId(sourceKey, folderId),
        label: label ?? file.name,
        weight: file.size,
      };
    }),
  );
  return queue.enqueue({
    operation: FileBatchOperation.UPLOAD,
    scope: FILE_MANAGER_SCOPE,
    items,
    concurrency: UPLOAD_CONCURRENCY,
  });
}
