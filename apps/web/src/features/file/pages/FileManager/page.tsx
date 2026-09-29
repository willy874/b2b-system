import { useCallback, useEffect, useMemo } from 'react';

import { BatchProgressBar } from '@/core/batch';

import { useFilePermission } from '../../hooks/useFilePermission';
import { useFileUpload } from '../../hooks/useFileUpload';
import { syncFileViewPreference, useFileViewPreferenceStore } from '../../preference';
import type { CollectedUpload } from '../../upload/collectEntries';
import { isFileItem } from './adapter';
import type { BrowserItemVM } from './adapter';
import { FileBreadcrumb } from './components/FileBreadcrumb';
import { FileBrowser } from './components/FileBrowser';
import { FileDeleteDialog } from './components/FileDeleteDialog';
import { FileEmptyState } from './components/FileEmptyState';
import { FileFolderDialog } from './components/FileFolderDialog';
import { FileFolderSidebar } from './components/FileFolderTree';
import { FileLightbox } from './components/FileLightbox';
import { FileManagerHeader } from './components/FileManagerHeader';
import { FileMoveDialog } from './components/FileMoveDialog';
import { FilePagination } from './components/FilePagination';
import { FileRenameDialog } from './components/FileRenameDialog';
import { FileSelectionBar } from './components/FileSelectionBar';
import { FileToolbar } from './components/FileToolbar';
import { useFileActions } from './useFileActions';
import { useFileManagerItems } from './useFileManagerItems';
import { useFileSearch } from './useFileSearch';
import { useFileSelection } from './useFileSelection';
import { draggedItemsOf, useItemDrag } from './useItemDrag';
import { useRenameTarget } from './useRenameTarget';

export default function FileManagerPage() {
  const permission = useFilePermission();
  const preference = useFileViewPreferenceStore();
  useEffect(syncFileViewPreference, []);
  const nav = useFileSearch();
  const { search, setFolder } = nav;
  const folderId = search.folder;
  const onMissingFolder = useCallback(() => setFolder(undefined, { replace: true }), [setFolder]);
  const { filters, data, folders, items } = useFileManagerItems({
    folderId,
    keyword: search.keyword,
    category: search.category,
    sort: preference.sort,
    pagingMode: preference.pagingMode,
    offset: search.offset,
    pageSize: preference.pageSize,
    onMissingFolder,
  });
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const selection = useFileSelection(ids);
  const selectedItems = items.filter((item) => selection.selected.has(item.id));
  const upload = useFileUpload({ enabled: permission.canUpload });
  const actions = useFileActions();
  const itemDrag = useItemDrag({
    enabled: permission.canMove,
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
  const hasFilters = Boolean(search.keyword || search.category);

  return (
    <div className="flex flex-col gap-3" data-testid="file-manager-page">
      <FileManagerHeader total={data.total} />

      <FileToolbar
        keyword={search.keyword}
        category={search.category}
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
        onRefresh={() => {
          data.refetch();
          void folders.refetch();
        }}
        refreshing={data.isFetching && !data.isPending}
      />
      <FileBreadcrumb path={folders.path} onNavigate={setFolder} itemDrag={itemDrag} />

      {actions.activeJobs.length > 0 && (
        <BatchProgressBar jobs={actions.activeJobs} onCancel={actions.cancelJob} />
      )}
      {items.length > 0 && (
        <FileSelectionBar
          count={selectedItems.length}
          total={items.length}
          canDownload={selectedItems.some(isFileItem)}
          canDelete={permission.canDelete}
          canRename={permission.canRename}
          canMove={permission.canMove}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onDownload={() => actions.download(selectedItems.filter(isFileItem))}
          onDelete={() => actions.requestDelete(selectedItems)}
          onRename={() => selectedItems[0] && renameTarget.rename(selectedItems[0])}
          onMove={() => actions.requestMove(draggedItemsOf(selectedItems, folderId))}
        />
      )}

      <div className="flex min-w-0 gap-3">
        <FileFolderSidebar
          folders={folders.index}
          selectedId={folderId}
          onSelect={setFolder}
          itemDrag={itemDrag}
          canMove={permission.canMove}
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
            onDeleteSelected={() => permission.canDelete && actions.requestDelete(selectedItems)}
            onStaleUrl={data.reportStaleUrl}
            canUpload={permission.canUpload}
            onDropUpload={onUpload}
            currentFolderId={folderId}
            itemDrag={itemDrag}
            canMove={permission.canMove}
            sort={preference.sort}
            onSortChange={(sort) => preference.update({ sort })}
            emptyContent={
              <FileEmptyState
                hasFilters={hasFilters}
                inFolder={Boolean(folderId)}
                canUpload={permission.canUpload}
                onClearFilters={() => nav.setFilters({ keyword: undefined, category: undefined })}
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
        canRename={permission.canRename}
        canDelete={permission.canDelete}
        onRename={renameTarget.renameFile}
        onDelete={(file) => actions.requestDelete([file])}
      />
      <FileRenameDialog file={renameTarget.file} onClose={renameTarget.closeFile} />
      <FileFolderDialog target={renameTarget.folderDialog} onClose={renameTarget.closeFolder} />
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
