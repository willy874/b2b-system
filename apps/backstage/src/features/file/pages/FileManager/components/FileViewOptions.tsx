import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Popover } from '@b2b-system/ui/Popover';
import { RadioGroup } from '@b2b-system/ui/Radio';
import { Select } from '@b2b-system/ui/Select';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { FileSortField } from '@/apis/file/types';

import { FILE_SORT_FIELDS, FILE_SORT_LABEL_KEY } from '../../../constants';
import type { FilePagingMode } from '../../../preference';

interface FileViewOptionsProps {
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  pagingMode: FilePagingMode;
  onPagingModeChange: (mode: FilePagingMode) => void;
}

/**
 * 檢視選項：排序與閱覽模式。兩者都是個人偏好、不常切換，收在一顆按鈕裡；改了立即生效，不必按套用。
 * 列表檢視另可點欄位標題排序（`FileListHeader`）。
 */
export function FileViewOptions({
  sort,
  onSortChange,
  pagingMode,
  onPagingModeChange,
}: FileViewOptionsProps) {
  const { t } = useTranslation();
  const orderLabel = sort.order === 'asc' ? t('common.sortAsc') : t('common.sortDesc');
  return (
    <Popover
      align="end"
      title={t('file.view.options')}
      className="flex w-64 flex-col gap-3"
      data-testid="file-view-options-popup"
      trigger={
        <IconButton size="sm" aria-label={t('file.view.options')} data-testid="file-view-options">
          <Icon name="sliders" size={16} />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-1">
        {/* 控制項各自以 aria-label 命名，這裡只是視覺標題 */}
        <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-hidden>
          {t('common.sort')}
        </span>
        <div className="flex items-center gap-1">
          <Select
            aria-label={t('common.sort')}
            value={sort.sort}
            onValueChange={(value) => onSortChange({ sort: value, order: sort.order })}
            options={FILE_SORT_FIELDS.map((value) => ({
              value,
              label: t(FILE_SORT_LABEL_KEY[value]),
            }))}
            className="min-w-0 flex-1"
            data-testid="file-sort"
          />
          <Tooltip content={orderLabel}>
            <IconButton
              aria-label={orderLabel}
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
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-hidden>
          {t('file.paging.label')}
        </span>
        <RadioGroup
          aria-label={t('file.paging.label')}
          value={pagingMode}
          onValueChange={onPagingModeChange}
          options={[
            { value: 'infinite', label: t('file.paging.infinite') },
            { value: 'pagination', label: t('file.paging.pagination') },
          ]}
          data-testid="file-paging-mode"
        />
      </div>
    </Popover>
  );
}
