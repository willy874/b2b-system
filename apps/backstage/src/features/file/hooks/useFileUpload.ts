import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getFileFolderEnsurePathsMutationOptions } from '@/apis/file/ensure-file-folder-paths/mutation';
import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { invalidateResources, Resource } from '@/apis/resources';
import { useBatchQueue } from '@/core/batch';
import { useErrorToast } from '@/core/errors';
import { validateFile } from '@/core/file';
import type { FileValidationIssue } from '@/core/file';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { enqueueFileUploads } from '../batch';
import type { QueuedUpload } from '../batch';
import { FOLDER_PATHS_PER_REQUEST } from '../constants';
import type { CollectedUpload } from '../upload/collectEntries';

const ensurePaths = getFileFolderEnsurePathsMutationOptions().mutationFn;

export interface RejectedFile {
  file: File;
  issues: FileValidationIssue[];
}

const pathKey = (path: readonly string[]) => path.join('/');

/**
 * 確保資料夾結構存在（`POST /file-folders/paths`，同名的沿用），回傳 路徑 → 資料夾 id。
 * 路徑多時分批送；每批都從同一個上層起算，已存在的上層會被沿用，所以分批不影響結果。
 */
async function ensureFolders(
  parentId: string | undefined,
  directories: readonly (readonly string[])[],
): Promise<Map<string, string>> {
  const unique = [...new Map(directories.map((path) => [pathKey(path), [...path]])).values()];
  const ids = new Map<string, string>();
  for (let start = 0; start < unique.length; start += FOLDER_PATHS_PER_REQUEST) {
    // 依序送：每批都在後端的樹鎖上排隊，並行只會互相等待
    // oxlint-disable-next-line no-await-in-loop -- 見上
    const { items } = await ensurePaths({
      params: {
        parentId: parentId ?? null,
        paths: unique.slice(start, start + FOLDER_PATHS_PER_REQUEST),
      },
    });
    for (const item of items) ids.set(pathKey(item.path), item.id);
  }
  return ids;
}

/**
 * 上傳入口（選檔、選資料夾、拖放共用；docs/architecture/frontend/12-file-manager.md §8）：
 * 1. 跑註冊的驗證器（`core/file`），被擋下的以 toast 列出第一個原因；
 * 2. 上傳資料夾時先在目的地建出同樣的資料夾結構（含空資料夾；同名的資料夾合併）；
 * 3. 通過的檔案帶著各自的目的地資料夾送進全域佇列。進度、取消、結果都由佇列處理。
 */
export function useFileUpload(options: { enabled: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const queue = useBatchQueue();
  const policy = useQuery({ ...getFileUploadPolicyQueryOptions(), enabled: options.enabled });
  const maxSize = policy.data?.maxSize;

  return useCallback(
    async (
      upload: CollectedUpload,
      folderId: string | undefined,
    ): Promise<{ accepted: QueuedUpload[]; rejected: RejectedFile[] }> => {
      const results = await Promise.all(
        upload.entries.map(async (entry) => ({
          entry,
          issues: await validateFile(entry.file, { maxSize }),
        })),
      );
      const rejected = results
        .filter((result) => result.issues.length > 0)
        .map(({ entry, issues }) => ({ file: entry.file, issues }));
      const acceptedEntries = results.filter((r) => r.issues.length === 0).map((r) => r.entry);

      const [first] = rejected;
      const firstIssue = first?.issues[0];
      if (first && firstIssue) {
        toast.error(
          t('file.upload.rejected', {
            count: rejected.length,
            name: first.file.name,
            reason: t(firstIssue.messageKey, firstIssue.params),
          }),
        );
      }

      let folderIds = new Map<string, string>();
      if (upload.directories.length > 0) {
        try {
          folderIds = await ensureFolders(folderId, upload.directories);
        } catch (error) {
          // 資料夾建不起來就不上傳：檔案不該落到錯的位置
          showError(error);
          return { accepted: [], rejected };
        }
        invalidateResources([{ resource: Resource.FILE_FOLDER, kind: 'create' }]);
      }

      const accepted = acceptedEntries.map(({ file, directories }) => ({
        file,
        folderId: directories.length > 0 ? folderIds.get(pathKey(directories)) : folderId,
        label: directories.length > 0 ? `${pathKey(directories)}/${file.name}` : file.name,
      }));
      if (accepted.length > 0) {
        if (!queue) throw new Error('批次佇列尚未註冊（batchQueuePlugin）');
        await enqueueFileUploads(queue, accepted);
        toast.info(t('file.upload.queued', { count: accepted.length }));
      }
      return { accepted, rejected };
    },
    [maxSize, queue, showError, t, toast],
  );
}
