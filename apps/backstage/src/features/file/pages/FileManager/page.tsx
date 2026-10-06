import { BatchProgressBar } from '@b2b-system/web-core/batch';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';

import { selectionCapabilities, useFilePermission } from '../../hooks/useFilePermission';
import { useFileUpload } from '../../hooks/useFileUpload';
import { syncFileViewPreference, useFileViewPreferenceStore } from '../../preference';
import type { CollectedUpload } from '../../upload/collectEntries';
import { isFileItem } from './adapter';
import type { BrowserItemVM } from './adapter';
import { FileAccessRequestDialog } from './components/FileAccessRequestDialog';
import { FileBreadcrumb } from './components/FileBreadcrumb';
import { FileBrowser } from './components/FileBrowser';
import { FileDeleteDialog } from './components/FileDeleteDialog';
import { FileEmptyState } from './components/FileEmptyState';
import { FileFolderDialog } from './components/FileFolderDialog';
import { FileFolderSidebar } from './components/FileFolderTree';
import { FileLightbox } from './components/FileLightbox';
import { FileLockedNotice } from './components/FileLockedNotice';
import { FileManagerHeader } from './components/FileManagerHeader';
import { FileMoveDialog } from './components/FileMoveDialog';
import { FilePagination } from './components/FilePagination';
import { FileRenameDialog } from './components/FileRenameDialog';
import { FileSelectionBar } from './components/FileSelectionBar';
import { FileShareDialog } from './components/FileShareDialog';
import { FileTagDialog } from './components/FileTagDialog';
import { FileToolbar } from './components/FileToolbar';
import { canCreateIn } from './folderTree';
import { useFileActions } from './useFileActions';
import { useFileManagerItems } from './useFileManagerItems';
import { useFileSearch } from './useFileSearch';
import { useFileSelection } from './useFileSelection';
import { draggedItemsOf, useItemDrag } from './useItemDrag';
import { useRenameTarget } from './useRenameTarget';

export default function FileManagerPage() {
  const preference = useFileViewPreferenceStore();
  useEffect(syncFileViewPreference, []);
  const nav = useFileSearch();
  const { search, setFolder } = nav;
  const folderId = search.folder;
  const onMissingFolder = useCallback(() => setFolder(undefined, { replace: true }), [setFolder]);
  // 預設位置是自己的個人資料夾（docs/rbac/07-resource-grants.md §12）：只在進入頁面時導一次，
  // 之後點「所有檔案」仍能回到根目錄
  const landed = useRef(Boolean(folderId));
  const { filters, data, folders, items, locked } = useFileManagerItems({
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
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string }>();
  const [requestTarget, setRequestTarget] = useState<{ id: string; name: string }>();
  const [tagTarget, setTagTarget] = useState<BrowserItemVM>();
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="file-manager-page">
      <FileManagerHeader total={data.total} />

      <FileToolbar
        keyword={search.keyword}
        category={search.category}
        tag={search.tag}
        tags={tags.data?.items}
        onFiltersChange={nav.setFilters}
        sort={preference.sort}
        onSortChange={(sort) => preference.update({ sort })}
        viewMode={preference.viewMode}
        onViewModeChange={(viewMode) => preference.update({ viewMode })}
        pagingMode={preference.pagingMode}
        onPagingModeChange={(pagingMode) => preference.update({ pagingMode })}
        canUpload={permission.canUpload}
        onUpload={onUpload}
        canCreateFolder={permission.canCreateFolder}
        onCreateFolder={() => renameTarget.createFolder(folderId)}
        canShare={permission.canShare}
        onShare={() => currentFolder && setShareTarget(currentFolder)}
        onRefresh={() => {
          data.refetch();
          void folders.refetch();
        }}
        refreshing={data.isFetching && !data.isPending}
      />
      <FileBreadcrumb path={folders.path} onNavigate={setFolder} itemDrag={itemDrag} />

      {locked && currentFolder && (
        <FileLockedNotice
          pending={currentFolder.hasPendingAccessRequest}
          onRequest={() => setRequestTarget(currentFolder)}
        />
      )}
      {actions.activeJobs.length > 0 && (
        <BatchProgressBar jobs={actions.activeJobs} onCancel={actions.cancelJob} />
      )}
      {items.length > 0 && (
        <FileSelectionBar
          count={selectedItems.length}
          total={items.length}
          canDownload={selectedItems.some(isFileItem)}
          canDelete={selected.canDelete}
          canRename={selected.canRename}
          canTag={selected.canTag}
          canMove={selected.canMove}
          canShare={selected.canShare}
          canRequestAccess={selected.canRequestAccess}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onDownload={() => actions.download(selectedItems.filter(isFileItem))}
          onDelete={() => actions.requestDelete(selectedItems)}
          onRename={() => selectedItems[0] && renameTarget.rename(selectedItems[0])}
          onTag={() => setTagTarget(selectedItems[0])}
          onMove={() => actions.requestMove(draggedItemsOf(selectedItems, folderId))}
          onShare={() => selectedItems[0] && setShareTarget(selectedItems[0])}
          onRequestAccess={() => selectedItems[0] && setRequestTarget(selectedItems[0])}
        />
      )}

      {/* 資料夾樹與主區塊填滿剩餘高度、各自捲動，分頁列固定在底部；畫面太矮時保留 24rem，改由主內容捲動 */}
      <div className="flex min-h-96 min-w-0 flex-1 gap-3">
        <FileFolderSidebar
          folders={folders.index}
          selectedId={folderId}
          onSelect={setFolder}
          itemDrag={itemDrag}
          canMove={permission.canAccess}
        />
        <div className="min-w-0 flex-1">
          <FileBrowser
            items={items}
            viewMode={preference.viewMode}
            selection={selection}
            loading={data.isPending || folders.isPending}
            hasMore={data.hasMore}
            loadingMore={data.isLoadingMore}
            onLoadMore={data.loadMore}
            onOpen={onOpen}
            onDeleteSelected={() => selected.canDelete && actions.requestDelete(selectedItems)}
            onStaleUrl={data.reportStaleUrl}
            canUpload={permission.canUpload}
            onDropUpload={onUpload}
            currentFolderId={folderId}
            itemDrag={itemDrag}
            canMove={permission.canAccess}
            canUploadInto={(target) => canCreateIn(folders.index, target)}
            sort={preference.sort}
            onSortChange={(sort) => preference.update({ sort })}
            error={data.error}
            onRetry={data.refetch}
            emptyContent={
              <FileEmptyState
                hasFilters={hasFilters}
                inFolder={Boolean(folderId)}
                canUpload={permission.canUpload}
                onClearFilters={() =>
                  nav.setFilters({ keyword: undefined, category: undefined, tag: undefined })
                }
              />
            }
          />
        </div>
      </div>

      {preference.pagingMode === 'pagination' && data.total > 0 && (
        <FilePagination
          offset={search.offset}
          pageSize={preference.pageSize}
          total={data.total}
          onOffsetChange={nav.setOffset}
          onPageSizeChange={(pageSize) => preference.update({ pageSize })}
        />
      )}

      <FileLightbox
        fileId={search.preview}
        items={data.items}
        onNavigate={nav.switchPreview}
        onClose={nav.closePreview}
        canRename={permission.canAccess}
        canDelete={permission.canAccess}
        onRename={renameTarget.renameFile}
        onDelete={(file) => actions.requestDelete([file])}
      />
      <FileRenameDialog file={renameTarget.file} onClose={renameTarget.closeFile} />
      <FileFolderDialog target={renameTarget.folderDialog} onClose={renameTarget.closeFolder} />
      <FileShareDialog folder={shareTarget} onClose={() => setShareTarget(undefined)} />
      <FileTagDialog item={tagTarget} onClose={() => setTagTarget(undefined)} />
      <FileAccessRequestDialog folder={requestTarget} onClose={() => setRequestTarget(undefined)} />
      <FileMoveDialog
        items={actions.pendingMove}
        folders={folders.index}
        pending={actions.moving}
        onMove={actions.moveItems}
        onClose={actions.cancelMove}
      />
      <FileDeleteDialog
        items={actions.pendingDelete}
        loading={actions.deleting}
        onCancel={actions.cancelDelete}
        onConfirm={async () => {
          const deleted = await actions.confirmDelete();
          // 正在預覽的檔案被刪了：關掉 LightBox
          if (deleted.some((item) => item.id === search.preview)) nav.closePreview();
        }}
      />
    </div>
  );
}
