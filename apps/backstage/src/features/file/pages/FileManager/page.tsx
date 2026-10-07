import { isFileItem } from './adapter';
import { FileAccessRequestDialog } from './components/FileAccessRequestDialog';
import { FileBatchProgress } from './components/FileBatchProgress';
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
import { useFileManagerPage } from './useFileManagerPage';
import { draggedItemsOf } from './useItemDrag';

/** 檔案管理器（docs/architecture/frontend/12-file-manager.md）：狀態與流程在 `useFileManagerPage`，這裡只組裝畫面。 */
export default function FileManagerPage() {
  const {
    nav,
    search,
    folderId,
    preference,
    data,
    folders,
    items,
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
    tags,
  } = useFileManagerPage();
  const { setFolder } = nav;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="file-manager-page">
      <FileManagerHeader total={data.total} />

      <FileToolbar
        keyword={search.keyword}
        category={search.category}
        tag={search.tag}
        tags={tags}
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
        onShare={() => dialogs.share(currentFolder)}
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
          onRequest={() => dialogs.requestAccess(currentFolder)}
        />
      )}
      <FileBatchProgress />
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
          onTag={() => dialogs.tag(selectedItems[0])}
          onMove={() => actions.requestMove(draggedItemsOf(selectedItems, folderId))}
          onShare={() => dialogs.share(selectedItems[0])}
          onRequestAccess={() => dialogs.requestAccess(selectedItems[0])}
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
      <FileShareDialog folder={dialogs.shareTarget} onClose={dialogs.closeShare} />
      <FileTagDialog item={dialogs.tagTarget} onClose={dialogs.closeTag} />
      <FileAccessRequestDialog folder={dialogs.requestTarget} onClose={dialogs.closeRequest} />
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
