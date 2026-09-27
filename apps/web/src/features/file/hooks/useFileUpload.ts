import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getFileUploadPolicyQueryOptions } from '@/apis/file/get-upload-policy/query';
import { useBatchQueue } from '@/core/batch';
import { validateFile } from '@/core/file';
import type { FileValidationIssue } from '@/core/file';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { enqueueFileUploads } from '../batch';

export interface RejectedFile {
  file: File;
  issues: FileValidationIssue[];
}

/**
 * 上傳入口（選檔、拖放共用）：先跑註冊的驗證器（`core/file`），通過的送進全域佇列，
 * 被擋下的以 toast 列出第一個原因。進度、取消、結果都由佇列處理。
 */
export function useFileUpload(options: { enabled: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queue = useBatchQueue();
  const policy = useQuery({ ...getFileUploadPolicyQueryOptions(), enabled: options.enabled });
  const maxSize = policy.data?.maxSize;

  return useCallback(
    async (files: readonly File[]): Promise<{ accepted: File[]; rejected: RejectedFile[] }> => {
      const results = await Promise.all(
        files.map(async (file) => ({ file, issues: await validateFile(file, { maxSize }) })),
      );
      const accepted = results.filter((result) => result.issues.length === 0).map((r) => r.file);
      const rejected = results.filter((result) => result.issues.length > 0);

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
      if (accepted.length > 0) {
        if (!queue) throw new Error('批次佇列尚未註冊（batchQueuePlugin）');
        await enqueueFileUploads(queue, accepted);
        toast.info(t('file.upload.queued', { count: accepted.length }));
      }
      return { accepted, rejected };
    },
    [maxSize, queue, t, toast],
  );
}
