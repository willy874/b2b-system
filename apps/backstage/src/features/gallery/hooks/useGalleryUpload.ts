import { useBatchQueue } from '@b2b-system/web-core/batch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { formatBytes } from '@b2b-system/web-shared/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getGalleryUploadsQueryOptions } from '@/apis/gallery/get-gallery-uploads/query';
import { matchesImageSignature } from '@/core/upload';
import type { CollectedUpload } from '@/core/upload';

import { enqueueGalleryUploads } from '../batch';
import { GALLERY_CONTENT_TYPES, HEIC_EXTENSION, HEIC_TYPES } from '../constants';

/** 一個不能上傳的檔案與原因（完整字面量的語系 key）。 */
export interface RejectedGalleryFile {
  file: File;
  reasonKey:
    | 'gallery.upload.heic'
    | 'gallery.upload.notImage'
    | 'gallery.upload.corrupted'
    | 'gallery.upload.tooLarge';
  reasonParams?: Record<string, string>;
}

/**
 * 選檔時的檢查（只是體驗；後端以檔頭與解碼結果再判斷一次）。
 * `maxSize` 是租戶的單檔上限（`GET /gallery/items/uploads` 的 `maxItemSize`）；拿不到時不檢查大小，交給後端。
 */
export async function checkGalleryUpload(
  file: File,
  maxSize?: number,
): Promise<RejectedGalleryFile | undefined> {
  if (HEIC_TYPES.includes(file.type) || HEIC_EXTENSION.test(file.name)) {
    return { file, reasonKey: 'gallery.upload.heic' };
  }
  if (!GALLERY_CONTENT_TYPES.includes(file.type))
    return { file, reasonKey: 'gallery.upload.notImage' };
  // 超過上限的檔案不要先搬進暫存區與佇列，到送出時才 413
  if (maxSize !== undefined && file.size > maxSize) {
    return {
      file,
      reasonKey: 'gallery.upload.tooLarge',
      reasonParams: { max: formatBytes(maxSize) },
    };
  }
  // 副檔名改掉的其他檔案、下載到一半的圖片：檔頭對不上
  if ((await matchesImageSignature(file, file.type)) === false) {
    return { file, reasonKey: 'gallery.upload.corrupted' };
  }
  return undefined;
}

/**
 * 上傳入口（選檔、拖曳、貼上共用；docs/architecture/frontend/24-gallery.md §4）：拖進來的資料夾只取裡面的圖片、不保留結構。
 * 不能上傳的以 toast 列出第一個原因；通過的送進全域批次佇列（進度、取消、跨分頁接手由佇列處理）。
 */
export function useGalleryUpload() {
  const { t } = useTranslation();
  const toast = useToast();
  const queue = useBatchQueue();
  const queryClient = useQueryClient();

  return useCallback(
    async (upload: CollectedUpload | readonly File[], albumId: string | undefined) => {
      const files = Array.isArray(upload)
        ? [...(upload as readonly File[])]
        : (upload as CollectedUpload).entries.map((entry) => entry.file);
      const maxSize = await queryClient
        .fetchQuery(getGalleryUploadsQueryOptions())
        .then((status) => status.maxItemSize)
        .catch(() => undefined);
      const checked = await Promise.all(
        files.map(async (file) => ({ file, rejected: await checkGalleryUpload(file, maxSize) })),
      );
      const rejected = checked.flatMap((entry) => (entry.rejected ? [entry.rejected] : []));
      const accepted = checked.filter((entry) => !entry.rejected).map((entry) => entry.file);
      const [first] = rejected;
      if (first) {
        toast.error(
          t('gallery.upload.rejected', {
            count: rejected.length,
            name: first.file.name,
            reason: t(first.reasonKey, first.reasonParams),
          }),
        );
      }
      if (accepted.length > 0) {
        if (!queue) throw new Error('批次佇列尚未註冊（batchQueuePlugin）');
        await enqueueGalleryUploads(
          queue,
          accepted.map((file) => ({ file, albumId })),
        );
        toast.info(t('gallery.upload.queued', { count: accepted.length }));
      }
      return { accepted, rejected };
    },
    [queue, queryClient, t, toast],
  );
}
