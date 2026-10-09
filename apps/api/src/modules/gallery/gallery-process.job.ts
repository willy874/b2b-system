import { defineJob } from '@/core/jobs';

import { GALLERY_PROCESS_CONCURRENCY } from './gallery.constants';

/**
 * 處理一張圖片庫的圖片（docs/architecture/backend/26-gallery.md §5）：在 worker 執行，sharp 的 CPU 不佔 API 的 event loop。
 * 重複排入無害：已經做好的步驟會略過。獨立成一個檔案：入列端（`GalleryItemService`）與執行端（`GalleryProcessService`）
 * 都 import 它，彼此不必互相依賴。
 */
export const GALLERY_PROCESS_JOB = defineJob<{ itemId: string }>('gallery.process', {
  concurrency: GALLERY_PROCESS_CONCURRENCY,
  retryLimit: 3,
  expireInSeconds: 10 * 60,
});
