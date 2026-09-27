import { useCallback, useEffect, useMemo, useState } from 'react';

import { AlertDialog } from '@/components/AlertDialog';
import { Button } from '@/components/Button';
import { Empty } from '@/components/Empty';
import { Pagination } from '@/components/Pagination';
import { BatchProgressBar } from '@/core/batch';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { FILE_PAGE_SIZES } from '../../constants';
import { useFilePermission } from '../../hooks/useFilePermission';
import { useFileUpload } from '../../hooks/useFileUpload';
import { syncFileViewPreference, useFileViewPreferenceStore } from '../../preference';
import type { FileItemVM } from './adapter';
import { FileBrowser } from './components/FileBrowser';
import { FileLightbox } from './components/FileLightbox';
import { FileRenameDialog } from './components/FileRenameDialog';
import { FileSelectionBar } from './components/FileSelectionBar';
import { FileToolbar } from './components/FileToolbar';
import { useFileActions } from './useFileActions';
import { useFileListData } from './useFileListData';
import { useFileSearch } from './useFileSearch';
import { useFileSelection } from './useFileSelection';

export default function FileManagerPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const permission = useFilePermission();
  const preference = useFileViewPreferenceStore();
  useEffect(syncFileViewPreference, []);
  const { search, setFilters, setOffset, openPreview, switchPreview, closePreview } =
    useFileSearch();

  const filters = useMemo(
    () => ({ keyword: search.keyword, category: search.category, sort: [preference.sort] }),
    [preference.sort, search.category, search.keyword],
  );
  const data = useFileListData({
    mode: preference.pagingMode,
    filters,
    offset: search.offset,
    pageSize: preference.pageSize,
  });
  const ids = useMemo(() => data.items.map((item) => item.id), [data.items]);
  const selection = useFileSelection(ids);
  const selectedItems = data.items.filter((item) => selection.selected.has(item.id));
  const upload = useFileUpload({ enabled: permission.canUpload });
  const actions = useFileActions();
  const [renameId, setRenameId] = useState<string>();
  const [renameFallback, setRenameFallback] = useState<FileItemVM>();
  // 改名對話框跟著最新的資料（別人改名後版本號更新）；LightBox 從深連結開啟、不在列表裡時用當下的資料
  const renaming = data.items.find((item) => item.id === renameId) ?? renameFallback;

  const { clear } = selection;
  // 換條件、換頁、換閱覽模式：原本的選取不在新的結果裡
  useEffect(clear, [clear, filters, search.offset, preference.pagingMode]);

  const onUpload = useCallback((files: File[]) => void upload(files), [upload]);
  const hasFilters = Boolean(search.keyword || search.category);

  return (
    <div className="flex flex-col gap-3" data-testid="file-manager-page">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('file.title')}</h1>
          <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">{t('file.description')}</p>
        </div>
        <span className="text-sm text-[var(--color-fg-muted)]" data-testid="file-total">
          {t('file.total', { count: data.total })}
        </span>
      </header>

      <FileToolbar
        keyword={search.keyword}
        category={search.category}
        onFiltersChange={setFilters}
        sort={preference.sort}
        onSortChange={(sort) => preference.update({ sort })}
        viewMode={preference.viewMode}
        onViewModeChange={(viewMode) => preference.update({ viewMode })}
        pagingMode={preference.pagingMode}
        onPagingModeChange={(pagingMode) => preference.update({ pagingMode })}
        canUpload={permission.canUpload}
        onUpload={onUpload}
        onRefresh={data.refetch}
        refreshing={data.isFetching && !data.isPending}
      />

      {actions.activeJobs.length > 0 && (
        <BatchProgressBar jobs={actions.activeJobs} onCancel={actions.cancelJob} />
      )}
      {data.items.length > 0 && (
        <FileSelectionBar
          count={selectedItems.length}
          total={data.items.length}
          canDelete={permission.canDelete}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onDownload={() => actions.download(selectedItems)}
          onDelete={() => actions.requestDelete(selectedItems)}
        />
      )}

      <FileBrowser
        items={data.items}
        viewMode={preference.viewMode}
        selection={selection}
        loading={data.isPending}
        hasMore={data.hasMore}
        loadingMore={data.isLoadingMore}
        onLoadMore={data.loadMore}
        onOpen={openPreview}
        onDeleteSelected={() => permission.canDelete && actions.requestDelete(selectedItems)}
        onStaleUrl={data.reportStaleUrl}
        canUpload={permission.canUpload}
        onDropFiles={onUpload}
        onDropDirectories={(count) =>
          toast.warning(t('file.upload.directoryUnsupported', { count }))
        }
        sort={preference.sort}
        onSortChange={(sort) => preference.update({ sort })}
        emptyContent={
          <Empty
            title={hasFilters ? t('file.empty.filtered') : t('file.empty.title')}
            description={
              hasFilters ? undefined : permission.canUpload ? t('file.empty.uploadHint') : undefined
            }
            action={
              hasFilters ? (
                <Button onClick={() => setFilters({ keyword: undefined, category: undefined })}>
                  {t('file.empty.clearFilters')}
                </Button>
              ) : undefined
            }
            data-testid="file-empty"
          />
        }
      />

      {preference.pagingMode === 'pagination' && data.total > 0 && (
        <Pagination
          offset={search.offset}
          limit={preference.pageSize}
          total={data.total}
          pageSizeOptions={[...FILE_PAGE_SIZES]}
          onChange={({ offset, limit }) => {
            if (limit !== preference.pageSize) preference.update({ pageSize: limit });
            setOffset(limit !== preference.pageSize ? 0 : offset);
          }}
          labels={{
            previous: t('common.previous'),
            next: t('common.next'),
            summary: ({ from, to, total }) => t('file.pagination.summary', { from, to, total }),
          }}
          data-testid="file-pagination"
        />
      )}

      <FileLightbox
        fileId={search.preview}
        items={data.items}
        onNavigate={switchPreview}
        onClose={closePreview}
        canRename={permission.canRename}
        canDelete={permission.canDelete}
        onRename={(file) => {
          setRenameFallback(file);
          setRenameId(file.id);
        }}
        onDelete={(file) => actions.requestDelete([file])}
      />
      <FileRenameDialog
        file={renaming && renameId ? renaming : undefined}
        onClose={() => setRenameId(undefined)}
      />
      <AlertDialog
        open={Boolean(actions.pendingDelete)}
        onOpenChange={(open) => !open && actions.cancelDelete()}
        title={t('file.delete.title')}
        description={
          (actions.pendingDelete?.length ?? 0) > 1
            ? t('file.batch.delete.confirm', { count: actions.pendingDelete?.length ?? 0 })
            : t('file.delete.confirm', { name: actions.pendingDelete?.[0]?.name ?? '' })
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={actions.deleting}
        onConfirm={async () => {
          const deleted = await actions.confirmDelete();
          // 正在預覽的檔案被刪了：關掉 LightBox
          if (deleted.some((file) => file.id === search.preview)) closePreview();
        }}
        data-testid="file-delete-dialog"
      />
    </div>
  );
}
