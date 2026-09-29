import { useMemo } from 'react';

import type { FileCategory, FileSortField } from '@/apis/file/types';
import type { SortEntry } from '@/shared/constants';

import type { FilePagingMode } from '../../preference';
import type { BrowserItemVM } from './adapter';
import { useFileListData } from './useFileListData';
import { useFolderView } from './useFolderView';

interface UseFileManagerItemsOptions {
  folderId: string | undefined;
  keyword: string | undefined;
  category: FileCategory | undefined;
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
  sort,
  pagingMode,
  offset,
  pageSize,
  onMissingFolder,
}: UseFileManagerItemsOptions) {
  const filters = useMemo(
    () => ({ keyword, category, folderId: folderId ?? 'root', sort: [sort] }),
    [category, folderId, keyword, sort],
  );
  const folders = useFolderView({ folderId, keyword, category, sort, onMissing: onMissingFolder });
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
