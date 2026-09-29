import { getFileFolderDeleteMutationOptions } from '@/apis/file/delete-file-folder/mutation';
import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { uploadFile } from '@/apis/file/upload-file/fetcher';
import { invalidateResources, Resource } from '@/apis/resources';
import { registerBatchOperation } from '@/core/batch';
import type { BatchQueueClient, BatchRunContext } from '@/core/batch';
import { ANY_ID, queryClient } from '@/core/cache';
import { AppError } from '@/core/errors';
import { createThumbnail } from '@/core/file';

import {
  DEFAULT_THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MAX_DIMENSION,
  UPLOAD_CONCURRENCY,
} from './constants';
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

const deleteFile = getFileDeleteMutationOptions().mutationFn;
const deleteFolder = getFileFolderDeleteMutationOptions().mutationFn;

/**
 * 佇列項目只能帶 id（要能跨 worker、跨分頁傳遞）：工作區與目的地資料夾都編進 id 裡，
 * 接手的分頁（可能開著別的工作區）也知道要傳到哪裡（docs/adr/0018-workspace-tenancy.md D8）。
 *
 * - 刪除：`<工作區 id>/<檔案或資料夾 id>`
 * - 上傳：`<工作區 id>/<暫存檔的 key>` 或 `<工作區 id>/<暫存檔的 key>@<資料夾 id>`
 */
const WORKSPACE_SEPARATOR = '/';
const FOLDER_SEPARATOR = '@';

export function workspaceItemId(workspaceId: string, id: string): string {
  return `${workspaceId}${WORKSPACE_SEPARATOR}${id}`;
}

export function parseWorkspaceItemId(itemId: string): { workspaceId: string; id: string } {
  const index = itemId.indexOf(WORKSPACE_SEPARATOR);
  if (index < 0)
    throw new AppError('VALIDATION_FAILED', 0, { reason: 'batch-item-without-workspace' });
  return { workspaceId: itemId.slice(0, index), id: itemId.slice(index + 1) };
}

export function uploadItemId(
  workspaceId: string,
  sourceKey: string,
  folderId: string | null | undefined,
): string {
  return workspaceItemId(
    workspaceId,
    folderId ? `${sourceKey}${FOLDER_SEPARATOR}${folderId}` : sourceKey,
  );
}

export function parseUploadItemId(itemId: string): {
  workspaceId: string;
  sourceKey: string;
  folderId?: string;
} {
  const { workspaceId, id } = parseWorkspaceItemId(itemId);
  const [sourceKey = id, folderId] = id.split(FOLDER_SEPARATOR);
  return folderId ? { workspaceId, sourceKey, folderId } : { workspaceId, sourceKey };
}

async function thumbnailFor(
  workspaceId: string,
  file: File,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  const policy = await queryClient
    .fetchQuery(getFileUploadPolicyQueryOptions(workspaceId))
    .catch(() => undefined);
  return createThumbnail(file, {
    maxDimension: THUMBNAIL_MAX_DIMENSION,
    maxBytes: policy?.thumbnailMaxSize ?? DEFAULT_THUMBNAIL_MAX_BYTES,
    signal,
  }).catch(() => undefined);
}

/**
 * 上傳一個排隊中的檔案（`itemId` 是 `uploadSources` 的 key）。
 * 在全域佇列裡與其他批次工作共用排程、進度、取消與結果彈窗（docs/adr/0013-file-manager-upload.md）。
 */
async function runUpload(
  itemId: string,
  { signal, reportProgress }: BatchRunContext,
): Promise<void> {
  const { workspaceId, sourceKey, folderId } = parseUploadItemId(itemId);
  const source = await uploadSources.get(sourceKey);
  // 發起的分頁關掉、而這台瀏覽器的 IndexedDB 不可用：接手的分頁拿不到檔案，只能請使用者重傳
  if (!(source instanceof File)) {
    throw new AppError('FILE_UPLOAD_INCOMPLETE', 0, { reason: 'source-unavailable' });
  }
  try {
    const thumbnail = await thumbnailFor(workspaceId, source, signal);
    const stored = await uploadFile(
      { workspaceId, file: source, folderId, thumbnail, onProgress: reportProgress },
      signal,
    );
    invalidateResources([{ resource: Resource.FILE, kind: 'create', id: stored.id }]);
  } finally {
    // 成功或失敗都不會再用到（佇列不自動重試；重傳由使用者重新選檔）
    await uploadSources.delete(sourceKey);
  }
}

/**
 * 在 plugin 的同步階段呼叫。每一筆呼叫一次單筆 API、失效快取（同單筆 mutation hook），
 * 不發 toast：結果由批次佇列在整批結束時彈出（docs/adr/0012-batch-queue-worker.md）。
 */
export function registerFileBatchOperations(): void {
  registerBatchOperation({
    id: FileBatchOperation.UPLOAD,
    labelKey: 'file.batch.upload.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.upload.success',
    run: runUpload,
  });
  registerBatchOperation({
    id: FileBatchOperation.DELETE,
    labelKey: 'file.batch.delete.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.delete.success',
    run: async (itemId, { signal }) => {
      const { workspaceId, id: fileId } = parseWorkspaceItemId(itemId);
      await deleteFile({ params: { workspaceId, fileId }, signal });
      invalidateResources([{ resource: Resource.FILE, kind: 'delete', id: fileId }]);
    },
  });
  registerBatchOperation({
    id: FileBatchOperation.DELETE_FOLDER,
    labelKey: 'file.batch.deleteFolder.title',
    localeScope: FILE_LOCALE_SCOPE,
    successKey: 'file.batch.deleteFolder.success',
    run: async (itemId, { signal }) => {
      const { workspaceId, id: folderId } = parseWorkspaceItemId(itemId);
      await deleteFolder({ params: { workspaceId, folderId }, signal });
      // 其中的檔案一起刪除了：檔案端無法逐筆得知
      invalidateResources([
        { resource: Resource.FILE_FOLDER, kind: 'delete', id: folderId },
        { resource: Resource.FILE, kind: 'delete', id: ANY_ID },
      ]);
    },
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
  workspaceId: string,
  uploads: readonly QueuedUpload[],
): Promise<string> {
  const items = await Promise.all(
    uploads.map(async ({ file, folderId, label }) => {
      const sourceKey = crypto.randomUUID();
      await uploadSources.put(sourceKey, file);
      return {
        id: uploadItemId(workspaceId, sourceKey, folderId),
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
