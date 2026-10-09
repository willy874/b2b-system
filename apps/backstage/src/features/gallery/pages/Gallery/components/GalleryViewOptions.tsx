import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Popover } from '@b2b-system/ui/Popover';
import { Select } from '@b2b-system/ui/Select';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useTranslation } from '@b2b-system/web-core/locales';

import { GALLERY_ROW_HEIGHTS } from '../../../constants';
import type { GalleryRowHeight } from '../../../constants';
import { GALLERY_SORTS } from '../../../routes';
import type { GallerySearch } from '../../../routes';
import type { GalleryGrouping, GalleryLayout } from '../preference';

const SORT_LABEL_KEY = {
  sortAt: 'gallery.sort.sortAt',
  createdAt: 'gallery.sort.createdAt',
  title: 'gallery.sort.title',
} as const satisfies Record<(typeof GALLERY_SORTS)[number], string>;

const GROUPING_LABEL_KEY = {
  day: 'gallery.view.groupDay',
  month: 'gallery.view.groupMonth',
  none: 'gallery.view.groupNone',
} as const satisfies Record<GalleryGrouping, string>;

interface GalleryViewOptionsProps {
  search: GallerySearch;
  onSearchChange: (patch: Partial<GallerySearch>) => void;
  layout: GalleryLayout;
  rowHeight: GalleryRowHeight;
  grouping: GalleryGrouping;
  onViewChange: (patch: { rowHeight?: GalleryRowHeight; grouping?: GalleryGrouping }) => void;
}

/**
 * 檢視選項：排序與反轉、依日期分組、縮放級別。不常切換，收在一顆按鈕裡（與檔案管理的 `FileViewOptions` 相同）；
 * 改了立即生效，不必按套用。排序在網址，分組與縮放是這台裝置的偏好。列表沒有分組與縮放。
 */
export function GalleryViewOptions({
  search,
  onSearchChange,
  layout,
  rowHeight,
  grouping,
  onViewChange,
}: GalleryViewOptionsProps) {
  const { t } = useTranslation();
  const sort = search.sort ?? 'sortAt';
  const zoomIndex = GALLERY_ROW_HEIGHTS.indexOf(rowHeight);
  const zoomTo = (index: number) => {
    const next = GALLERY_ROW_HEIGHTS[index];
    if (next) onViewChange({ rowHeight: next });
  };
  return (
    <Popover
      align="end"
      title={t('gallery.view.options')}
      className="flex w-64 flex-col gap-3"
      data-testid="gallery-view-options-popup"
      trigger={
        <IconButton
          size="sm"
          aria-label={t('gallery.view.options')}
          data-testid="gallery-view-options"
        >
          <Icon name="sliders" size={16} />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-1">
        {/* 控制項各自以 aria-label 命名，這裡只是視覺標題 */}
        <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-hidden>
          {t('gallery.sort.label')}
        </span>
        <div className="flex items-center gap-1">
          <Select
            options={GALLERY_SORTS.map((value) => ({ value, label: t(SORT_LABEL_KEY[value]) }))}
            value={sort}
            onValueChange={(value) =>
              onSearchChange({
                sort: value === 'sortAt' ? undefined : (value as GallerySearch['sort']),
              })
            }
            aria-label={t('gallery.sort.label')}
            className="min-w-0 flex-1"
            data-testid="gallery-sort"
          />
          <Tooltip content={t('gallery.sort.reverse')}>
            <IconButton
              aria-label={t('gallery.sort.reverse')}
              aria-pressed={search.reverse === true}
              onClick={() => onSearchChange({ reverse: search.reverse ? undefined : true })}
              data-testid="gallery-sort-reverse"
            >
              <Icon name="arrow-up-down" size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      {layout !== 'list' && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-hidden>
              {t('gallery.view.grouping')}
            </span>
            <Select
              options={(['day', 'month', 'none'] as const).map((value) => ({
                value,
                label: t(GROUPING_LABEL_KEY[value]),
              }))}
              value={grouping}
              onValueChange={(value) => onViewChange({ grouping: value as GalleryGrouping })}
              aria-label={t('gallery.view.grouping')}
              data-testid="gallery-grouping"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-hidden>
              {t('gallery.view.zoom')}
            </span>
            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                aria-label={t('gallery.view.zoomOut')}
                disabled={zoomIndex <= 0}
                onClick={() => zoomTo(zoomIndex - 1)}
                data-testid="gallery-zoom-out"
              >
                <Icon name="zoom-out" size={14} />
              </IconButton>
              <input
                type="range"
                min={0}
                max={GALLERY_ROW_HEIGHTS.length - 1}
                step={1}
                value={Math.max(0, zoomIndex)}
                onChange={(event) => zoomTo(Number(event.target.value))}
                aria-label={t('gallery.view.zoom')}
                className="min-w-0 flex-1"
                data-testid="gallery-zoom"
              />
              <IconButton
                size="sm"
                aria-label={t('gallery.view.zoomIn')}
                disabled={zoomIndex >= GALLERY_ROW_HEIGHTS.length - 1}
                onClick={() => zoomTo(zoomIndex + 1)}
                data-testid="gallery-zoom-in"
              >
                <Icon name="zoom-in" size={14} />
              </IconButton>
            </div>
          </div>
        </>
      )}
    </Popover>
  );
}
