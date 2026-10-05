import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Menu } from '@b2b-system/ui/Menu';
import { Select } from '@b2b-system/ui/Select';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { useEffect, useRef, useState } from 'react';

import type { FileCategory, FileSortField } from '@/apis/file/types';
import type { Tag } from '@/shared/api-sdk';

import {
  FILE_CATEGORIES,
  FILE_CATEGORY_LABEL_KEY,
  FILE_SORT_FIELDS,
  FILE_SORT_LABEL_KEY,
} from '../../../constants';
import type { FilePagingMode, FileViewMode } from '../../../preference';
import { collectFromFileList } from '../../../upload/collectEntries';
import type { CollectedUpload } from '../../../upload/collectEntries';

/** 打字停下來多久才搜尋：每個字都打一次 API 沒有意義。 */
const SEARCH_DEBOUNCE_MS = 300;
const ALL = '__all__';

interface FileToolbarProps {
  keyword: string | undefined;
  category: FileCategory | undefined;
  /** 標籤篩選（任一符合）。 */
  tag: string[] | undefined;
  /** `file` 標籤組的標籤；沒有任何標籤時不顯示標籤篩選。 */
  tags: readonly Tag[] | undefined;
  onFiltersChange: (
    filters: {
      keyword: string | undefined;
      category: FileCategory | undefined;
      tag: string[] | undefined;
    },
    replace: boolean,
  ) => void;
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  viewMode: FileViewMode;
  onViewModeChange: (mode: FileViewMode) => void;
  pagingMode: FilePagingMode;
  onPagingModeChange: (mode: FilePagingMode) => void;
  canUpload: boolean;
  onUpload: (upload: CollectedUpload) => void;
  canCreateFolder: boolean;
  onCreateFolder: () => void;
  /** 目前所在的資料夾能管理授權時顯示「共用此資料夾」。 */
  canShare: boolean;
  onShare: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

/** 搜尋、分類篩選、排序、排列方式、閱覽模式、新增資料夾、上傳（檔案或資料夾）。窄螢幕自動換行。 */
export function FileToolbar({
  keyword,
  category,
  tag,
  tags,
  onFiltersChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  pagingMode,
  onPagingModeChange,
  canUpload,
  onUpload,
  canCreateFolder,
  onCreateFolder,
  canShare,
  onShare,
  onRefresh,
  refreshing,
}: FileToolbarProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(keyword ?? '');
  const [syncedKeyword, setSyncedKeyword] = useState(keyword);
  // 網址被外部改變（上一頁、清除篩選）時同步輸入框（render 期間調整 state，不經過 effect）
  if (syncedKeyword !== keyword) {
    setSyncedKeyword(keyword);
    setDraft(keyword ?? '');
  }
  useEffect(() => {
    const next = draft.trim() || undefined;
    if (next === keyword) return undefined;
    const timer = setTimeout(
      () => onFiltersChange({ keyword: next, category, tag }, true),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [category, draft, keyword, onFiltersChange, tag]);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="file-toolbar">
      <div className="relative w-full sm:w-auto sm:max-w-80 sm:min-w-48 sm:flex-1">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--color-fg-muted)]"
        />
        <Input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('file.search.placeholder')}
          aria-label={t('common.search')}
          className="w-full pl-8"
          data-testid="file-search"
        />
      </div>
      <Select
        aria-label={t('file.field.category')}
        value={category ?? ALL}
        onValueChange={(value) =>
          onFiltersChange(
            { keyword, tag, category: value === ALL ? undefined : (value as FileCategory) },
            false,
          )
        }
        options={[
          { value: ALL, label: t('file.category.all') },
          ...FILE_CATEGORIES.map((value) => ({ value, label: t(FILE_CATEGORY_LABEL_KEY[value]) })),
        ]}
        className="min-w-0 flex-1 sm:w-36 sm:flex-none"
        data-testid="file-category"
      />
      {tags && tags.length > 0 && (
        <Select
          multiple
          searchable
          aria-label={t('tag.filter')}
          placeholder={t('tag.filterPlaceholder')}
          value={tag ?? []}
          onValueChange={(next) =>
            onFiltersChange({ keyword, category, tag: next.length ? next : undefined }, false)
          }
          options={tags.map((item) => ({ value: item.id, label: item.name }))}
          maxTagCount={1}
          className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          data-testid="file-tag-filter"
        />
      )}
      <div className="flex min-w-0 flex-1 items-center sm:flex-none">
        <Select
          aria-label={t('common.sort')}
          value={sort.sort}
          onValueChange={(value) => onSortChange({ sort: value, order: sort.order })}
          options={FILE_SORT_FIELDS.map((value) => ({
            value,
            label: t(FILE_SORT_LABEL_KEY[value]),
          }))}
          className="min-w-0 flex-1 sm:w-32 sm:flex-none"
          data-testid="file-sort"
        />
        <Tooltip content={sort.order === 'asc' ? t('common.sortAsc') : t('common.sortDesc')}>
          <IconButton
            aria-label={sort.order === 'asc' ? t('common.sortAsc') : t('common.sortDesc')}
            onClick={() =>
              onSortChange({ sort: sort.sort, order: sort.order === 'asc' ? 'desc' : 'asc' })
            }
            data-testid="file-sort-order"
            data-value={sort.order}
          >
            <Icon name={sort.order === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex w-full flex-wrap items-center gap-1 sm:ml-auto sm:w-auto sm:flex-nowrap">
        <fieldset
          aria-label={t('file.view.label')}
          className="m-0 flex rounded-md border border-[var(--color-border)] p-0.5"
        >
          <IconButton
            size="sm"
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            aria-label={t('file.view.grid')}
            aria-pressed={viewMode === 'grid'}
            onClick={() => onViewModeChange('grid')}
            data-testid="file-view-mode"
            data-value="grid"
          >
            <Icon name="grid" size={16} />
          </IconButton>
          <IconButton
            size="sm"
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            aria-label={t('file.view.list')}
            aria-pressed={viewMode === 'list'}
            onClick={() => onViewModeChange('list')}
            data-testid="file-view-mode"
            data-value="list"
          >
            <Icon name="list" size={16} />
          </IconButton>
        </fieldset>
        <Select
          aria-label={t('file.paging.label')}
          value={pagingMode}
          onValueChange={onPagingModeChange}
          options={[
            { value: 'infinite', label: t('file.paging.infinite') },
            { value: 'pagination', label: t('file.paging.pagination') },
          ]}
          className="min-w-0 flex-1 sm:w-32 sm:flex-none"
          data-testid="file-paging-mode"
        />
        <Tooltip content={t('file.refresh')}>
          <IconButton
            aria-label={t('file.refresh')}
            onClick={onRefresh}
            loading={refreshing}
            data-testid="file-refresh"
          >
            <Icon name="refresh" size={16} />
          </IconButton>
        </Tooltip>
        {canShare && (
          <Button
            startIcon={<Icon name="users" size={16} />}
            onClick={onShare}
            data-testid="file-share-button"
          >
            {t('file.share.openCurrent')}
          </Button>
        )}
        {canCreateFolder && (
          <Button
            startIcon={<Icon name="folder-plus" size={16} />}
            onClick={onCreateFolder}
            data-testid="file-create-folder-button"
          >
            {t('file.folder.create.action')}
          </Button>
        )}
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const upload = collectFromFileList(Array.from(event.target.files ?? []));
                // 清空才能再次選同一個檔案
                event.target.value = '';
                if (upload.entries.length > 0) onUpload(upload);
              }}
              data-testid="file-upload-input"
            />
            <input
              // webkitdirectory 不在 React 的屬性型別裡（非標準但各大瀏覽器都支援）；以 ref 設定
              ref={(element) => {
                directoryInput.current = element;
                element?.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const upload = collectFromFileList(Array.from(event.target.files ?? []));
                event.target.value = '';
                if (upload.entries.length > 0 || upload.directories.length > 0) onUpload(upload);
              }}
              data-testid="file-upload-directory-input"
            />
            <Menu
              align="end"
              trigger={
                <Button
                  variant="primary"
                  startIcon={<Icon name="upload" size={16} />}
                  endIcon={<Icon name="chevron-down" size={14} />}
                  data-testid="file-upload-button"
                >
                  {t('file.upload.action')}
                </Button>
              }
              items={[
                {
                  key: 'files',
                  textValue: t('file.upload.files'),
                  label: (
                    <span className="flex items-center gap-2">
                      <Icon name="file" size={14} />
                      {t('file.upload.files')}
                    </span>
                  ),
                  onSelect: () => input.current?.click(),
                },
                {
                  key: 'directory',
                  textValue: t('file.upload.directory'),
                  label: (
                    <span className="flex items-center gap-2">
                      <Icon name="folder-upload" size={14} />
                      {t('file.upload.directory')}
                    </span>
                  ),
                  onSelect: () => directoryInput.current?.click(),
                },
              ]}
              data-testid="file-upload-menu"
            />
          </>
        )}
      </div>
    </div>
  );
}
