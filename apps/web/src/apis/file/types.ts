import type { SortEntry } from '@/shared/constants';

/** 後端 `ListFileSchema` 的排序白名單。 */
export type FileSortField = 'createdAt' | 'name' | 'size';

export interface FileListParams {
  offset: number;
  limit: number;
  keyword?: string;
  /** `image/png` 精確比對；`image/*` 比對整個主類型。 */
  contentType?: string;
  sort?: Array<SortEntry<FileSortField>>;
}
