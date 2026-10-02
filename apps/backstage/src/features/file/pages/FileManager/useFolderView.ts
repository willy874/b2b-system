import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { getFileFolderListQueryOptions } from '@/apis/file/get-file-folder-list/query';
import type { FileCategory, FileSortField } from '@/apis/file/types';
import type { SortEntry } from '@/shared/constants';

import { toFolderItemVM } from './adapter';
import type { FolderItemVM } from './adapter';
import { buildFolderIndex, childFolders, folderPath } from './folderTree';

/** 資料夾清單還沒載入：根目錄當作不能建立（按鈕不會先出現再消失）。 */
const NO_ROOT_ACCESS = { canCreate: false } as const;

interface UseFolderViewOptions {
  folderId: string | undefined;
  keyword: string | undefined;
  category: FileCategory | undefined;
  /** 標籤篩選（任一符合，docs/architecture/backend/18-tag.md §7.2 D6）。 */
  tag: readonly string[] | undefined;
  sort: SortEntry<FileSortField>;
  /** 網址上的資料夾不存在（被刪除、連結過期）。 */
  onMissing: () => void;
}

/**
 * 資料夾的資料（docs/architecture/frontend/12-file-manager.md §12）：一份扁平清單組成索引，
 * 算出麵包屑、主區塊要顯示的子資料夾（排在檔案前面）。
 *
 * - 搜尋時子資料夾也依名稱篩選；選了檔案分類時不顯示資料夾（資料夾沒有類型）；選了標籤時只留貼了其中任一個的。
 * - 資料夾永遠依名稱排序：依大小、上傳時間排序時仍以名稱排，只跟著「名稱遞減」反轉。
 */
export function useFolderView({
  folderId,
  keyword,
  category,
  tag,
  sort,
  onMissing,
}: UseFolderViewOptions) {
  const query = useQuery(getFileFolderListQueryOptions());
  const index = useMemo(
    () => buildFolderIndex(query.data?.items ?? [], query.data?.rootCapabilities ?? NO_ROOT_ACCESS),
    [query.data],
  );
  const path = useMemo(() => folderPath(index, folderId), [folderId, index]);

  const missing = query.isSuccess && folderId !== undefined && !index.byId.has(folderId);
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  const items: FolderItemVM[] = useMemo(() => {
    if (category) return [];
    const needle = keyword?.toLowerCase();
    const tagIds = tag ? new Set(tag) : undefined;
    const folders = childFolders(index, folderId).filter(
      (folder) =>
        (!needle || folder.name.toLowerCase().includes(needle)) &&
        (!tagIds || folder.tags.some((item) => tagIds.has(item.id))),
    );
    const ordered = sort.sort === 'name' && sort.order === 'desc' ? folders.toReversed() : folders;
    return ordered.map((folder) => toFolderItemVM(folder, childFolders(index, folder.id).length));
  }, [category, folderId, index, keyword, sort.order, sort.sort, tag]);

  return {
    index,
    path,
    items,
    /** 自己的個人資料夾（docs/rbac/07-resource-grants.md §12）；清單還沒載入或沒有時 undefined。 */
    personalFolderId: query.data?.personalFolderId ?? undefined,
    /** 目前位置（資料夾或根目錄）的能力；清單還沒載入時 undefined。 */
    location: query.data
      ? folderId
        ? index.byId.get(folderId)?.capabilities
        : { ...index.root, canRead: true }
      : undefined,
    isPending: query.isPending,
    refetch: query.refetch,
  };
}
