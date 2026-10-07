import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { ActiveFilters, FilterBar, TableSearch } from '@b2b-system/web-core/components';
import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { FileSortField } from '@/apis/file/types';

import type { FilePagingMode, FileViewMode } from '../../../preference';
import type { FileFilterValues } from '../useFileFilters';
import { FileViewOptions } from './FileViewOptions';

interface FileToolbarProps {
  /** 分類、標籤收在篩選面板（`useFileFilters`）；關鍵字由常駐的搜尋框輸入。 */
  filters: FilterBarProps<FileFilterValues>;
  /** 打字搜尋：以 replace 寫進網址，不讓每個字都留一筆瀏覽紀錄。 */
  onKeywordChange: (keyword: string | undefined) => void;
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  viewMode: FileViewMode;
  onViewModeChange: (mode: FileViewMode) => void;
  pagingMode: FilePagingMode;
  onPagingModeChange: (mode: FilePagingMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * 找檔案與怎麼看：左邊是搜尋與套用中的篩選條件，右邊是篩選、檢視選項（排序、閱覽模式）、排列方式、重新整理。
 * 版面與其他列表頁一致（`RichTable` 的搜尋框、篩選面板、條件 Chip）；對資料夾的動作在頁首（`FileActions`）。
 */
export function FileToolbar({
  filters,
  onKeywordChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  pagingMode,
  onPagingModeChange,
  onRefresh,
  refreshing,
}: FileToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="file-toolbar">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="w-full sm:w-80">
          <TableSearch
            value={filters.value.keyword}
            onChange={onKeywordChange}
            placeholder={t('file.search.placeholder')}
          />
        </div>
        <ActiveFilters filters={filters} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <FilterBar {...filters} data-testid="file-filter" />
        <FileViewOptions
          sort={sort}
          onSortChange={onSortChange}
          pagingMode={pagingMode}
          onPagingModeChange={onPagingModeChange}
        />
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
        <Tooltip content={t('file.refresh')}>
          <IconButton
            size="sm"
            aria-label={t('file.refresh')}
            onClick={onRefresh}
            loading={refreshing}
            data-testid="file-refresh"
          >
            <Icon name="refresh" size={16} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
