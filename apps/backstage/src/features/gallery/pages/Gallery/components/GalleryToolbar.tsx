import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';

import { GALLERY_ROW_HEIGHTS } from '../../../constants';
import type { GalleryRowHeight } from '../../../constants';
import { GALLERY_ORIENTATIONS, GALLERY_SORTS } from '../../../routes';
import type { GallerySearch } from '../../../routes';
import type { GalleryGrouping, GalleryLayout } from '../preference';

const ANY = '*';

const SORT_LABEL_KEY = {
  sortAt: 'gallery.sort.sortAt',
  createdAt: 'gallery.sort.createdAt',
  title: 'gallery.sort.title',
} as const satisfies Record<(typeof GALLERY_SORTS)[number], string>;

const ORIENTATION_LABEL_KEY = {
  landscape: 'gallery.filter.landscape',
  portrait: 'gallery.filter.portrait',
  square: 'gallery.filter.square',
} as const satisfies Record<(typeof GALLERY_ORIENTATIONS)[number], string>;

const GROUPING_LABEL_KEY = {
  day: 'gallery.view.groupDay',
  month: 'gallery.view.groupMonth',
  none: 'gallery.view.groupNone',
} as const satisfies Record<GalleryGrouping, string>;

/** 關鍵字打完 300ms 才寫進網址：每打一個字就換一份列表會閃。 */
const KEYWORD_DEBOUNCE_MS = 300;

interface GalleryToolbarProps {
  search: GallerySearch;
  onSearchChange: (patch: Partial<GallerySearch>) => void;
  layout: GalleryLayout;
  rowHeight: GalleryRowHeight;
  grouping: GalleryGrouping;
  onViewChange: (patch: {
    layout?: GalleryLayout;
    rowHeight?: GalleryRowHeight;
    grouping?: GalleryGrouping;
  }) => void;
}

/**
 * 搜尋與篩選（關鍵字、標籤、拍攝日期、方向、來源）、排序、排版、縮放級別與分組（docs/architecture/frontend/24-gallery.md §3、§5）。
 * 篩選與排序在網址；排版、縮放、分組是這台裝置的偏好。
 */
export function GalleryToolbar({
  search,
  onSearchChange,
  layout,
  rowHeight,
  grouping,
  onViewChange,
}: GalleryToolbarProps) {
  const { t } = useTranslation();
  const tags = useQuery(getTagListQueryOptions('gallery'));
  const [keyword, setKeyword] = useState(search.keyword ?? '');
  // 網址的關鍵字被別的地方改了（上一頁、清除篩選）：在 render 時跟上，不經過 effect
  const [syncedKeyword, setSyncedKeyword] = useState(search.keyword);
  if (syncedKeyword !== search.keyword) {
    setSyncedKeyword(search.keyword);
    setKeyword(search.keyword ?? '');
  }
  useEffect(() => {
    if ((search.keyword ?? '') === keyword) return undefined;
    const timer = setTimeout(
      () => onSearchChange({ keyword: keyword.trim() || undefined }),
      KEYWORD_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [keyword, onSearchChange, search.keyword]);

  const sort = search.sort ?? 'sortAt';
  const zoomIndex = GALLERY_ROW_HEIGHTS.indexOf(rowHeight);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="gallery-toolbar">
      <Input
        size="sm"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('gallery.filter.keyword')}
        aria-label={t('gallery.filter.keyword')}
        className="w-48"
        data-testid="gallery-filter-keyword"
      />
      <Select
        size="sm"
        multiple
        options={(tags.data?.items ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
        value={search.tag ?? []}
        onValueChange={(value) => onSearchChange({ tag: value.length > 0 ? value : undefined })}
        placeholder={t('gallery.filter.tag')}
        aria-label={t('gallery.filter.tag')}
        className="!w-40"
        data-testid="gallery-filter-tag"
      />
      <span className="flex items-center gap-1 text-sm">
        <Input
          size="sm"
          type="date"
          value={search.from ?? ''}
          onChange={(event) => onSearchChange({ from: event.target.value || undefined })}
          aria-label={t('gallery.filter.from')}
          className="w-36"
          data-testid="gallery-filter-from"
        />
        <span aria-hidden>–</span>
        <Input
          size="sm"
          type="date"
          value={search.to ?? ''}
          onChange={(event) => onSearchChange({ to: event.target.value || undefined })}
          aria-label={t('gallery.filter.to')}
          className="w-36"
          data-testid="gallery-filter-to"
        />
      </span>
      <Select
        size="sm"
        options={[
          { value: ANY, label: t('gallery.filter.anyOrientation') },
          ...GALLERY_ORIENTATIONS.map((value) => ({
            value,
            label: t(ORIENTATION_LABEL_KEY[value]),
          })),
        ]}
        value={search.orientation ?? ANY}
        onValueChange={(value) =>
          onSearchChange({
            orientation: value === ANY ? undefined : (value as GallerySearch['orientation']),
          })
        }
        aria-label={t('gallery.filter.orientation')}
        className="!w-32"
        data-testid="gallery-filter-orientation"
      />
      <Select
        size="sm"
        options={[
          { value: ANY, label: t('gallery.filter.anyOrigin') },
          { value: 'upload', label: t('gallery.filter.uploaded') },
          { value: 'added', label: t('gallery.filter.added') },
        ]}
        value={search.origin ?? ANY}
        onValueChange={(value) =>
          onSearchChange({ origin: value === ANY ? undefined : (value as 'upload' | 'added') })
        }
        aria-label={t('gallery.filter.origin')}
        className="!w-40"
        data-testid="gallery-filter-origin"
      />
      <span className="ml-auto flex flex-wrap items-center gap-1">
        <Select
          size="sm"
          options={GALLERY_SORTS.map((value) => ({ value, label: t(SORT_LABEL_KEY[value]) }))}
          value={sort}
          onValueChange={(value) =>
            onSearchChange({
              sort: value === 'sortAt' ? undefined : (value as GallerySearch['sort']),
            })
          }
          aria-label={t('gallery.sort.label')}
          className="!w-32"
          data-testid="gallery-sort"
        />
        <IconButton
          size="sm"
          aria-label={t('gallery.sort.reverse')}
          aria-pressed={search.reverse === true}
          onClick={() => onSearchChange({ reverse: search.reverse ? undefined : true })}
          data-testid="gallery-sort-reverse"
        >
          <Icon name="arrow-up-down" size={14} />
        </IconButton>
        <Select
          size="sm"
          options={(['day', 'month', 'none'] as const).map((value) => ({
            value,
            label: t(GROUPING_LABEL_KEY[value]),
          }))}
          value={grouping}
          onValueChange={(value) => onViewChange({ grouping: value as GalleryGrouping })}
          aria-label={t('gallery.view.grouping')}
          className="!w-28"
          data-testid="gallery-grouping"
        />
        <IconButton
          size="sm"
          aria-label={
            layout === 'justified' ? t('gallery.view.square') : t('gallery.view.justified')
          }
          onClick={() => onViewChange({ layout: layout === 'justified' ? 'square' : 'justified' })}
          data-testid="gallery-layout-toggle"
          data-value={layout}
        >
          <Icon name={layout === 'justified' ? 'grid' : 'list'} size={14} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t('gallery.view.zoomOut')}
          disabled={zoomIndex <= 0}
          onClick={() => {
            const next = GALLERY_ROW_HEIGHTS[zoomIndex - 1];
            if (next) onViewChange({ rowHeight: next });
          }}
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
          onChange={(event) => {
            const next = GALLERY_ROW_HEIGHTS[Number(event.target.value)];
            if (next) onViewChange({ rowHeight: next });
          }}
          aria-label={t('gallery.view.zoom')}
          className="w-20"
          data-testid="gallery-zoom"
        />
        <IconButton
          size="sm"
          aria-label={t('gallery.view.zoomIn')}
          disabled={zoomIndex >= GALLERY_ROW_HEIGHTS.length - 1}
          onClick={() => {
            const next = GALLERY_ROW_HEIGHTS[zoomIndex + 1];
            if (next) onViewChange({ rowHeight: next });
          }}
          data-testid="gallery-zoom-in"
        >
          <Icon name="zoom-in" size={14} />
        </IconButton>
      </span>
    </div>
  );
}
