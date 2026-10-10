import { z } from 'zod/mini';

/** 方向的篩選（由顯示的寬高算）。 */
export const GALLERY_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

/** 排序：`sortAt`（圖片日期：EXIF 的拍攝時間，沒有時是加入時間）、`createdAt`（加入時間）、`title`。 */
export const GALLERY_SORTS = ['sortAt', 'createdAt', 'title'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 圖片庫的網址（docs/architecture/frontend/24-gallery.md §2）：篩選、排序與開著的檢視器都在網址，可以分享、上一頁回到前一個狀態。
 * `.catch()`：使用者手改成不合法的值時當作沒有帶，不變成錯誤頁。
 */
export const GallerySearchSchema = z.object({
  /** 開著的檢視器（`?item=<id>`）。 */
  item: z.catch(z.optional(z.uuid()), undefined),
  keyword: z.catch(z.optional(z.string().check(z.trim(), z.maxLength(100))), undefined),
  /** 貼了其中任一個標籤。 */
  // 只有一個值時網址的序列化是單一字串、多個時是陣列：一律轉成陣列
  tag: z.catch(
    z.optional(
      z.pipe(
        z.union([z.uuid(), z.array(z.uuid()).check(z.minLength(1), z.maxLength(20))]),
        z.transform((value) => (Array.isArray(value) ? value : [value])),
      ),
    ),
    undefined,
  ),
  /** 圖片日期（含）的範圍，`YYYY-MM-DD`，以瀏覽器的時區解讀。 */
  from: z.catch(z.optional(z.string().check(z.regex(DAY))), undefined),
  to: z.catch(z.optional(z.string().check(z.regex(DAY))), undefined),
  orientation: z.catch(z.optional(z.enum(GALLERY_ORIENTATIONS)), undefined),
  origin: z.catch(z.optional(z.enum(['upload', 'added'])), undefined),
  sort: z.catch(z.optional(z.enum(GALLERY_SORTS)), undefined),
  /** 方向反轉（預設新到舊、標題 A→Z）。 */
  reverse: z.catch(z.optional(z.boolean()), undefined),
});

export type GallerySearch = z.infer<typeof GallerySearchSchema>;
