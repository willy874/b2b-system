import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { ActiveFilters, FilterBar, TableSearch } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';

import type { GalleryRowHeight } from '../../../constants';
import type { GallerySearch } from '../../../routes';
import { GALLERY_LAYOUTS } from '../preference';
import type { GalleryGrouping, GalleryLayout } from '../preference';
import { useGalleryFilters } from '../useGalleryFilters';
import { GalleryViewOptions } from './GalleryViewOptions';

const LAYOUT_LABEL_KEY = {
  justified: 'gallery.view.justified',
  square: 'gallery.view.square',
  list: 'gallery.view.list',
} as const satisfies Record<GalleryLayout, string>;

const LAYOUT_ICON = {
  justified: 'file-image',
  square: 'grid',
  list: 'list',
} as const satisfies Record<GalleryLayout, IconName>;

interface GalleryToolbarProps {
  search: GallerySearch;
  onSearchChange: (patch: Partial<GallerySearch>) => void;
  layout: GalleryLayout;
  /** 窄螢幕固定方格：等高排列不能選（docs/architecture/frontend/24-gallery.md §3）。 */
  narrow: boolean;
  rowHeight: GalleryRowHeight;
  grouping: GalleryGrouping;
  onViewChange: (patch: {
    layout?: GalleryLayout;
    rowHeight?: GalleryRowHeight;
    grouping?: GalleryGrouping;
  }) => void;
}

/**
 * 找圖與怎麼看（docs/architecture/frontend/24-gallery.md §3、§5），版面與檔案管理的 `FileToolbar` 一致：
 * 左邊是常駐的搜尋框與套用中的篩選條件，右邊是篩選面板（標籤、圖片日期、方向、來源）、檢視選項（排序、分組、縮放）、顯示方式。
 * 篩選與排序在網址；顯示方式、縮放、分組是這台裝置的偏好。
 */
export function GalleryToolbar({
  search,
  onSearchChange,
  layout,
  narrow,
  rowHeight,
  grouping,
  onViewChange,
}: GalleryToolbarProps) {
  const { t } = useTranslation();
  const tags = useQuery(getTagListQueryOptions('gallery'));
  const filters = useGalleryFilters(search, onSearchChange, tags.data?.items);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="gallery-toolbar">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="w-full sm:w-80">
          <TableSearch
            value={search.keyword}
            onChange={(keyword) => onSearchChange({ keyword })}
            placeholder={t('gallery.filter.keyword')}
          />
        </div>
        <ActiveFilters filters={filters} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <FilterBar {...filters} data-testid="gallery-filter" />
        <GalleryViewOptions
          search={search}
          onSearchChange={onSearchChange}
          layout={layout}
          rowHeight={rowHeight}
          grouping={grouping}
          onViewChange={onViewChange}
        />
        <fieldset
          aria-label={t('gallery.view.mode')}
          className="m-0 flex rounded-md border border-[var(--color-border)] p-0.5"
        >
          {GALLERY_LAYOUTS.filter((value) => !narrow || value !== 'justified').map((value) => (
            <IconButton
              key={value}
              size="sm"
              variant={layout === value ? 'secondary' : 'ghost'}
              aria-label={t(LAYOUT_LABEL_KEY[value])}
              aria-pressed={layout === value}
              onClick={() => onViewChange({ layout: value })}
              data-testid="gallery-view-mode"
              data-value={value}
            >
              <Icon name={LAYOUT_ICON[value]} size={16} />
            </IconButton>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
