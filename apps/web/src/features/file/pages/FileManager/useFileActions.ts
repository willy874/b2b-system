import { useCallback, useState } from 'react';

import { isBatchJobActive, useBatchJobs, useBatchQueue } from '@/core/batch';

import { FILE_MANAGER_SCOPE, FileBatchOperation } from '../../batch';
import { useFileDeleteMutation } from '../../hooks/useFileMutations';
import type { FileItemVM } from './adapter';

/** 多個下載之間的間隔：同一瞬間觸發多個下載，瀏覽器只會處理第一個。 */
const DOWNLOAD_INTERVAL_MS = 250;

/**
 * 檔案管理器的刪除與下載：
 * - 單一檔案直接呼叫單筆 API（有即時的成功／失敗提示）
 * - 多個檔案送進全域批次佇列逐筆刪除（進度、取消、結果由佇列處理；docs/adr/0012-batch-queue-worker.md）
 */
export function useFileActions() {
  const queue = useBatchQueue();
  const deleteOne = useFileDeleteMutation();
  const [pendingDelete, setPendingDelete] = useState<readonly FileItemVM[]>();
  const jobs = useBatchJobs();
  const activeJobs = jobs.filter(
    (job) => job.scope === FILE_MANAGER_SCOPE && isBatchJobActive(job),
  );

  const confirmDelete = useCallback(async () => {
    const targets = pendingDelete ?? [];
    const [only] = targets;
    if (targets.length === 1 && only) {
      await deleteOne.mutateAsync({ params: { fileId: only.id } }).catch(() => undefined);
    } else if (targets.length > 1 && queue) {
      queue.enqueue({
        operation: FileBatchOperation.DELETE,
        scope: FILE_MANAGER_SCOPE,
        items: targets.map((file) => ({ id: file.id, label: file.name })),
      });
    }
    setPendingDelete(undefined);
    return targets;
  }, [deleteOne, pendingDelete, queue]);

  const download = useCallback((files: readonly FileItemVM[]) => {
    files
      .filter((file) => file.downloadUrl)
      .forEach((file, index) => {
        setTimeout(() => {
          const anchor = document.createElement('a');
          anchor.href = file.downloadUrl ?? '';
          anchor.download = file.name;
          anchor.rel = 'noopener';
          anchor.click();
        }, index * DOWNLOAD_INTERVAL_MS);
      });
  }, []);

  return {
    activeJobs,
    cancelJob: (jobId: string) => queue?.cancel(jobId),
    pendingDelete,
    requestDelete: setPendingDelete,
    cancelDelete: () => setPendingDelete(undefined),
    confirmDelete,
    deleting: deleteOne.isPending,
    download,
  };
}
