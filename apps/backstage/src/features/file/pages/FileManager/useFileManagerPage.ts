import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import type { CollectedUpload } from '@/core/upload';

import { selectionCapabilities, useFilePermission } from '../../hooks/useFilePermission';
import { useFileUpload } from '../../hooks/useFileUpload';
import { syncFileViewPreference, useFileViewPreferenceStore } from '../../preference';
import type { BrowserItemVM } from './adapter';
import { useFileActions } from './useFileActions';
import { useFileDialogs } from './useFileDialogs';
import { useFileFilters } from './useFileFilters';
import { useFileManagerItems } from './useFileManagerItems';
import { useFileSearch } from './useFileSearch';
import { useFileSelection } from './useFileSelection';
import { useItemDrag } from './useItemDrag';
import { useRenameTarget } from './useRenameTarget';

/**
 * 檔案管理器頁面的狀態與流程（`page.tsx` 只把這裡的輸出接到元件）：
 * 網址上的位置與條件、偏好、主區塊的項目、權限、選取、對話框的對象、上傳、拖曳移動與批次操作。
 */
export function useFileManagerPage() {
  const preference = useFileViewPreferenceStore();
  useEffect(syncFileViewPreference, []);
  const nav = useFileSearch();
  const { search, setFolder } = nav;
  const folderId = search.folder;
  const onMissingFolder = useCallback(() => setFolder(undefined, { replace: true }), [setFolder]);
  // 預設位置是自己的個人資料夾（docs/architecture/iam/06-resource-grants.md §12）：只在進入頁面時導一次，
  // 之後點「所有檔案」仍能回到根目錄
  const landed = useRef(Boolean(folderId));
  const { filters, data, folders, items, placeholder, locked } = useFileManagerItems({
    folderId,
    keyword: search.keyword,
    category: search.category,
    tag: search.tag,
    sort: preference.sort,
    pagingMode: preference.pagingMode,
    offset: search.offset,
    pageSize: preference.pageSize,
    onMissingFolder,
  });
  // 按鈕看後端的 capabilities：目前位置、選取的項目（docs/architecture/frontend/12-file-manager.md §13）
  const permission = useFilePermission(folders.location);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const { personalFolderId } = folders;
  useEffect(() => {
    if (landed.current || !personalFolderId) return;
    landed.current = true;
    setFolder(personalFolderId, { replace: true });
  }, [personalFolderId, setFolder]);
  const selection = useFileSelection(ids);
  const selectedItems = items.filter((item) => selection.selected.has(item.id));
  const selected = selectionCapabilities(selectedItems);
  const dialogs = useFileDialogs();
  const currentFolder = folderId ? folders.index.byId.get(folderId) : undefined;
  const upload = useFileUpload({ enabled: permission.canUpload });
  const actions = useFileActions();
  const itemDrag = useItemDrag({
    enabled: permission.canAccess,
    folders: folders.index,
    onMove: actions.dropItems,
  });
  const renameTarget = useRenameTarget(data.items);

  const { clear } = selection;
  // 換資料夾、換條件、換頁、換閱覽模式：原本的選取不在新的結果裡
  useEffect(clear, [clear, filters, search.offset, preference.pagingMode]);

  const onUpload = useCallback(
    (collected: CollectedUpload, target?: string) => void upload(collected, target ?? folderId),
    [folderId, upload],
  );
  const onOpen = (item: BrowserItemVM) =>
    item.type === 'folder' ? setFolder(item.id) : nav.openPreview(item.id);
  const hasFilters = Boolean(search.keyword || search.category || search.tag);
  // 標籤篩選的選項（`file` 標籤組；進得了檔案管理器就讀得到，docs/architecture/backend/18-tag.md §7.2 D5）
  const tags = useQuery(getTagListQueryOptions('file'));
  const filterBar = useFileFilters(search, nav.setFilters, tags.data?.items);

  return {
    nav,
    search,
    folderId,
    preference,
    data,
    folders,
    items,
    placeholder,
    locked,
    permission,
    currentFolder,
    selection,
    selectedItems,
    selected,
    dialogs,
    actions,
    itemDrag,
    renameTarget,
    onUpload,
    onOpen,
    hasFilters,
    filterBar,
  };
}
