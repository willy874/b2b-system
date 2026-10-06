import type { SortEntry } from '@b2b-system/web-shared/constants';
import { useMemo } from 'react';

import type { FileCategory, FileSortField } from '@/apis/file/types';

import type { FilePagingMode } from '../../preference';
import type { BrowserItemVM } from './adapter';
import { useFileListData } from './useFileListData';
import { useFolderView } from './useFolderView';

interface UseFileManagerItemsOptions {
  folderId: string | undefined;
  keyword: string | undefined;
  category: FileCategory | undefined;
  /** 標籤篩選（任一符合）；檔案由後端篩、資料夾在前端篩。 */
  tag: string[] | undefined;
  sort: SortEntry<FileSortField>;
  pagingMode: FilePagingMode;
  offset: number;
  pageSize: number;
  onMissingFolder: () => void;
}

/**
 * 主區塊的項目：目前資料夾的子資料夾（`useFolderView`）排在檔案（`useFileListData`）前面。
 * 分頁模式只有第一頁放資料夾——檔案的 offset 分頁不包含資料夾，放在每一頁會重複出現。
 */
export function useFileManagerItems({
  folderId,
  keyword,
  category,
  tag,
  sort,
  pagingMode,
  offset,
  pageSize,
  onMissingFolder,
}: UseFileManagerItemsOptions) {
  // 依排序的值、不依物件參考：偏好更新時換了新的 sort 物件，不該讓頁面以為條件變了而清空選取
  const { sort: sortField, order: sortOrder } = sort;
  const filters = useMemo(
    () => ({
      keyword,
      category,
      tagId: tag,
      folderId: folderId ?? 'root',
      sort: [{ sort: sortField, order: sortOrder }],
    }),
    [category, folderId, keyword, sortField, sortOrder, tag],
  );
  const folders = useFolderView({
    folderId,
    keyword,
    category,
    tag,
    sort,
    onMissing: onMissingFolder,
  });
  // 鎖住的資料夾（docs/rbac/07-resource-grants.md §5.1）看得到子資料夾、看不到檔案：不查檔案。
  // 資料夾清單載入前也先不查，避免對鎖住的資料夾送出一個註定 403 的請求
  const locked = Boolean(folderId) && folders.location?.canRead !== true;
  const data = useFileListData({
    mode: pagingMode,
    filters,
    offset,
    pageSize,
    enabled: !locked,
  });
  const items: BrowserItemVM[] = useMemo(
    () =>
      pagingMode === 'pagination' && offset > 0 ? data.items : [...folders.items, ...data.items],
    [data.items, folders.items, offset, pagingMode],
  );
  return { filters, data, folders, items, locked };
}
