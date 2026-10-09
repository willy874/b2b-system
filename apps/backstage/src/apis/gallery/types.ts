import type { SortEntry } from '@b2b-system/web-shared/constants';

/** 後端 `GALLERY_SORT_FIELDS` 的排序白名單（docs/architecture/backend/26-gallery.md §6）。 */
export type GallerySortField = 'sortAt' | 'createdAt' | 'title';

export type GalleryOrientation = 'landscape' | 'portrait' | 'square';

/** 列表、時間軸、上一張／下一張共用的篩選（後端的 `GalleryFilterShape`）。 */
export interface GalleryItemFilters {
  keyword?: string;
  albumId?: string;
  tagId?: string[];
  /** ISO 8601；`takenTo` 不含。 */
  takenFrom?: string;
  takenTo?: string;
  orientation?: GalleryOrientation;
  uploaderId?: string;
  origin?: 'upload' | 'added';
  /** 選圖用：只列能當這個用途的圖。 */
  imageUsage?: string;
  sort?: Array<SortEntry<GallerySortField>>;
}
