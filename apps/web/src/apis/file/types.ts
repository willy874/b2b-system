import type { SortEntry } from '@/shared/constants';

/** 後端 `ListFileSchema` 的排序白名單。 */
export type FileSortField = 'createdAt' | 'name' | 'size';

/** 後端 `FILE_CATEGORIES`（apps/api/src/modules/file/file.constants.ts）。 */
export type FileCategory = 'image' | 'video' | 'audio' | 'text' | 'document' | 'archive' | 'other';

export interface FileListFilters {
  keyword?: string;
  /** `image/png` 精確比對；`image/*` 比對整個主類型。 */
  contentType?: string;
  category?: FileCategory;
  uploaderId?: string;
  sort?: Array<SortEntry<FileSortField>>;
}

export interface FileListParams extends FileListFilters {
  offset: number;
  limit: number;
  /** keyset 分頁的游標（上一頁的 `nextCursor`）；帶了就忽略 `offset`。 */
  cursor?: string;
}
