import type { BatchRunContext } from '@b2b-system/web-core/batch';
import { ANY_ID, queryClient } from '@b2b-system/web-core/cache';

import { getFileFolderDeleteMutationOptions } from '@/apis/file/delete-file-folder/mutation';
import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { uploadFile } from '@/apis/file/upload-file/fetcher';
import { Resource } from '@/apis/resources';
import { createThumbnail } from '@/core/file';
import { createUploadRunner } from '@/core/upload';

import { DEFAULT_THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_DIMENSION } from './constants';
import { ROOT_FOLDER } from './pages/FileManager/folderTree';
import { fileUploadSources } from './upload/uploadSources';

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
 * 上傳一個排隊中的檔案（`itemId` 是 `<暫存 key>@<資料夾 id>`）。取檔、限流時保留、刪暫存檔由 `core/upload` 的 runner 處理；
 * 在全域佇列裡與其他批次工作共用排程、進度、取消與結果彈窗（docs/architecture/frontend/12-file-manager.md §14）。
 */
export const uploadRun = createUploadRunner({
  sources: fileUploadSources,
  incompleteCode: 'FILE_UPLOAD_INCOMPLETE',
  upload: async (file, folderId, { signal, reportProgress, invalidate }) => {
    const thumbnail = await thumbnailFor(file, signal);
    const stored = await uploadFile(
      { file, folderId, thumbnail, onProgress: reportProgress },
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
  },
  onSettled: ({ invalidate }) =>
    invalidate([{ resource: Resource.FILE_STORAGE_USAGE, kind: 'update' }]),
});

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
