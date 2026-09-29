import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { getFileFolderListQueryOptions } from '@/apis/file/get-file-folder-list/query';
import type { FileCategory, FileSortField } from '@/apis/file/types';
import type { SortEntry } from '@/shared/constants';

import { toFolderItemVM } from './adapter';
import type { FolderItemVM } from './adapter';
import { buildFolderIndex, childFolders, folderPath } from './folderTree';

interface UseFolderViewOptions {
  folderId: string | undefined;
  keyword: string | undefined;
  category: FileCategory | undefined;
  sort: SortEntry<FileSortField>;
  /** 網址上的資料夾不存在（被刪除、連結過期）。 */
  onMissing: () => void;
}

/**
 * 資料夾的資料（docs/architecture/frontend/12-file-manager.md §12）：一份扁平清單組成索引，
 * 算出麵包屑、主區塊要顯示的子資料夾（排在檔案前面）。
 *
 * - 搜尋時子資料夾也依名稱篩選；選了檔案分類時不顯示資料夾（資料夾沒有類型）。
 * - 資料夾永遠依名稱排序：依大小、上傳時間排序時仍以名稱排，只跟著「名稱遞減」反轉。
 */
export function useFolderView({
  folderId,
  keyword,
  category,
  sort,
  onMissing,
}: UseFolderViewOptions) {
  const query = useQuery(getFileFolderListQueryOptions());
  const index = useMemo(() => buildFolderIndex(query.data?.items ?? []), [query.data]);
  const path = useMemo(() => folderPath(index, folderId), [folderId, index]);

  const missing = query.isSuccess && folderId !== undefined && !index.byId.has(folderId);
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  const items: FolderItemVM[] = useMemo(() => {
    if (category) return [];
    const needle = keyword?.toLowerCase();
    const folders = childFolders(index, folderId).filter(
      (folder) => !needle || folder.name.toLowerCase().includes(needle),
    );
    const ordered = sort.sort === 'name' && sort.order === 'desc' ? folders.toReversed() : folders;
    return ordered.map((folder) => toFolderItemVM(folder, childFolders(index, folder.id).length));
  }, [category, folderId, index, keyword, sort.order, sort.sort]);

  return { index, path, items, isPending: query.isPending, refetch: query.refetch };
}
