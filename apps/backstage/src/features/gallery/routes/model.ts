import { z } from 'zod';

/** 方向的篩選（由顯示的寬高算）。 */
export const GALLERY_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

/** 排序：`sortAt`（拍攝時間，沒有時是加入時間）、`createdAt`（加入時間）、`title`。 */
export const GALLERY_SORTS = ['sortAt', 'createdAt', 'title'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 圖片庫的網址（docs/architecture/frontend/24-gallery.md §2）：篩選、排序與開著的檢視器都在網址，可以分享、上一頁回到前一個狀態。
 * `.catch()`：使用者手改成不合法的值時當作沒有帶，不變成錯誤頁。
 */
export const GallerySearchSchema = z.object({
  /** 開著的檢視器（`?item=<id>`）。 */
  item: z.string().uuid().optional().catch(undefined),
  keyword: z.string().trim().max(100).optional().catch(undefined),
  /** 貼了其中任一個標籤。 */
  // 只有一個值時網址的序列化是單一字串、多個時是陣列：一律轉成陣列
  tag: z
    .union([z.string().uuid(), z.array(z.string().uuid()).min(1).max(20)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
    .catch(undefined),
  /** 拍攝日期（含）的範圍，`YYYY-MM-DD`，以瀏覽器的時區解讀。 */
  from: z.string().regex(DAY).optional().catch(undefined),
  to: z.string().regex(DAY).optional().catch(undefined),
  orientation: z.enum(GALLERY_ORIENTATIONS).optional().catch(undefined),
  origin: z.enum(['upload', 'added']).optional().catch(undefined),
  sort: z.enum(GALLERY_SORTS).optional().catch(undefined),
  /** 方向反轉（預設新到舊、標題 A→Z）。 */
  reverse: z.boolean().optional().catch(undefined),
});

export type GallerySearch = z.infer<typeof GallerySearchSchema>;
