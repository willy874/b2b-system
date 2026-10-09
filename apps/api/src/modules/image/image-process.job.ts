import { defineJob } from '@/core/jobs';

/**
 * 正規化一張圖片資產並產生目前版本的變體（docs/architecture/backend/25-image.md §15.5）：在 worker 執行，
 * sharp 的 CPU 不佔 API 的 event loop（docs/architecture/01-system.md §7 D9）。重複排入無害：已經做好的步驟會略過。
 * 獨立成一個檔案：入列端（`ImageAssetService`）與執行端（`ImageProcessService`）都 import 它，彼此不必互相依賴。
 */
export const IMAGE_PROCESS_JOB = defineJob<{ assetId: string }>('image.process', {
  retryLimit: 3,
  expireInSeconds: 5 * 60,
});
