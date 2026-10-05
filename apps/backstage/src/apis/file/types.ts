import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { SetFileFolderGrantRequest } from '@/shared/api-sdk';

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
  /** 貼了其中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）。 */
  tagId?: string[];
  /** 只列這個資料夾直接包含的檔案；`root` 是根目錄，不帶則不分資料夾。 */
  folderId?: string;
  sort?: Array<SortEntry<FileSortField>>;
}

export interface FileListParams extends FileListFilters {
  offset: number;
  limit: number;
  /** keyset 分頁的游標（上一頁的 `nextCursor`）；帶了就忽略 `offset`。 */
  cursor?: string;
}

/** 資料夾授權的對象種類與等級（docs/rbac/07-resource-grants.md §2、§6.2）。 */
export type FileGrantSubjectType = SetFileFolderGrantRequest['subjectType'];
export type FileGrantLevel = SetFileFolderGrantRequest['level'];
