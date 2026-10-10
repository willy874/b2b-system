import type { BatchRunContext } from '@b2b-system/web-core/batch';
import { ANY_ID, queryClient } from '@b2b-system/web-core/cache';
import { AppError, ErrorCodes, isAppError } from '@b2b-system/web-core/errors';

import { getFileFolderDeleteMutationOptions } from '@/apis/file/delete-file-folder/mutation';
import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { uploadFile } from '@/apis/file/upload-file/fetcher';
import { Resource } from '@/apis/resources';
import { createThumbnail } from '@/core/file';

import { parseUploadItemId } from './batch';
import { DEFAULT_THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_DIMENSION } from './constants';
import { ROOT_FOLDER } from './pages/FileManager/folderTree';
import { uploadSources } from './upload/uploadSources';

/**
 * 檔案批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入，分段上傳、縮圖與 API 的程式不進首頁的初始載入
 * （docs/architecture/frontend/02-plugin-system.md §4.8）。
 */
const deleteFile = getFileDeleteMutationOptions().mutationFn;
const deleteFolder = getFileFolderDeleteMutationOptions().mutationFn;

async function thumbnailFor(file: File, signal: AbortSignal): Promise<Blob | undefined> {
  const policy = await queryClient
    .fetchQuery(getFileUploadPolicyQueryOptions())
    .catch(() => undefined);
  return createThumbnail(file, {
    maxDimension: THUMBNAIL_MAX_DIMENSION,
    maxBytes: policy?.thumbnailMaxSize ?? DEFAULT_THUMBNAIL_MAX_BYTES,
    signal,
  }).catch(() => undefined);
}

/**
 * 上傳一個排隊中的檔案（`itemId` 是 `uploadSources` 的 key）。
 * 在全域佇列裡與其他批次工作共用排程、進度、取消與結果彈窗（docs/architecture/frontend/12-file-manager.md §14）。
 */
export async function uploadRun(
  itemId: string,
  { signal, reportProgress, invalidate }: BatchRunContext,
): Promise<void> {
  const { sourceKey, folderId } = parseUploadItemId(itemId);
  const source = await uploadSources.get(sourceKey);
  // 發起的分頁關掉、而這台瀏覽器的 IndexedDB 不可用：接手的分頁拿不到檔案，只能請使用者重傳
  if (!(source instanceof File)) {
    throw new AppError('FILE_UPLOAD_INCOMPLETE', 0, { reason: 'source-unavailable' });
  }
  let willRetry = false;
  try {
    const thumbnail = await thumbnailFor(source, signal);
    const stored = await uploadFile(
      { file: source, folderId, thumbnail, onProgress: reportProgress },
      signal,
    );
    // 帶目的地資料夾：只重抓那個資料夾與不分資料夾的列表（同後端推播的 refs，apis/resources.ts 的 scopedCollection）
    invalidate([
      {
        resource: Resource.FILE,
        kind: 'create',
        id: stored.id,
        refs: { [Resource.FILE_FOLDER]: [folderId ?? ROOT_FOLDER] },
      },
    ]);
  } catch (error) {
    // 被限流的那一筆由佇列在時間到後重送（docs/architecture/frontend/07-ui-system.md §13.4）：檔案要留著
    willRetry = isAppError(error) && error.code === ErrorCodes.RATE_LIMITED;
    throw error;
  } finally {
    // 登記就佔用了容量（失敗、取消的上傳也要到永久刪除才釋出）：成功與否都重抓已用量
    invalidate([{ resource: Resource.FILE_STORAGE_USAGE, kind: 'update' }]);
    // 其餘情況都不會再用到（佇列只重送被限流的；其他失敗由使用者重新選檔）
    if (!willRetry) await uploadSources.delete(sourceKey);
  }
}

export async function deleteFileRun(
  fileId: string,
  { signal, invalidate }: BatchRunContext,
): Promise<void> {
  await deleteFile({ params: { fileId }, signal });
  invalidate([{ resource: Resource.FILE, kind: 'delete', id: fileId }]);
}

export async function deleteFolderRun(
  folderId: string,
  { signal, invalidate }: BatchRunContext,
): Promise<void> {
  await deleteFolder({ params: { folderId }, signal });
  // 其中的檔案一起刪除了：檔案端無法逐筆得知
  invalidate([
    { resource: Resource.FILE_FOLDER, kind: 'delete', id: folderId },
    { resource: Resource.FILE, kind: 'delete', id: ANY_ID },
  ]);
}
