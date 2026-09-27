import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { uploadFile } from '@/apis/file/upload-file/fetcher';
import { invalidateResources, Resource } from '@/apis/resources';
import { registerBatchOperation } from '@/core/batch';
import type { BatchQueueClient, BatchRunContext } from '@/core/batch';
import { queryClient } from '@/core/cache';
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
} as const;

/** 檔案管理器在佇列裡的識別（`BatchJob.scope`）：主區塊以它找出自己送出的工作。 */
export const FILE_MANAGER_SCOPE = 'file-manager';

const deleteFile = getFileDeleteMutationOptions().mutationFn;

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
 * 在全域佇列裡與其他批次工作共用排程、進度、取消與結果彈窗（docs/adr/0013-file-manager-upload.md）。
 */
async function runUpload(
  sourceId: string,
  { signal, reportProgress }: BatchRunContext,
): Promise<void> {
  const source = await uploadSources.get(sourceId);
  // 發起的分頁關掉、而這台瀏覽器的 IndexedDB 不可用：接手的分頁拿不到檔案，只能請使用者重傳
  if (!(source instanceof File)) {
    throw new AppError('FILE_UPLOAD_INCOMPLETE', 0, { reason: 'source-unavailable' });
  }
  try {
    const thumbnail = await thumbnailFor(source, signal);
    const stored = await uploadFile(
      { file: source, thumbnail, onProgress: reportProgress },
      signal,
    );
    invalidateResources([{ resource: Resource.FILE, kind: 'create', id: stored.id }]);
  } finally {
    // 成功或失敗都不會再用到（佇列不自動重試；重傳由使用者重新選檔）
    await uploadSources.delete(sourceId);
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
    run: async (fileId, { signal }) => {
      await deleteFile({ params: { fileId }, signal });
      invalidateResources([{ resource: Resource.FILE, kind: 'delete', id: fileId }]);
    },
  });
}

/**
 * 把檔案送進全域佇列：先放進 `uploadSources`，佇列項目只帶 id 與顯示用的名稱、大小。
 * 回傳工作 id。
 */
export async function enqueueFileUploads(
  queue: BatchQueueClient,
  files: readonly File[],
): Promise<string> {
  const items = await Promise.all(
    files.map(async (file) => {
      const id = crypto.randomUUID();
      await uploadSources.put(id, file);
      return { id, label: file.name, weight: file.size };
    }),
  );
  return queue.enqueue({
    operation: FileBatchOperation.UPLOAD,
    scope: FILE_MANAGER_SCOPE,
    items,
    concurrency: UPLOAD_CONCURRENCY,
  });
}
