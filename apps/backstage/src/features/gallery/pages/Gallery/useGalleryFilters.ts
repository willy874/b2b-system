import type { DateRangeFilterValue, FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { Tag } from '@/shared/api-sdk';

import { GALLERY_ORIENTATIONS } from '../../routes';
import type { GallerySearch } from '../../routes';

// `type` 而不是 `interface`：`FilterBarProps` 要求 `Record<string, unknown>`，interface 沒有隱含的索引簽章
export type GalleryFilterValues = {
  keyword: GallerySearch['keyword'];
  tag: GallerySearch['tag'];
  /** 網址裡是分開的 `from`／`to`，面板裡是一個日期區間。 */
  date: DateRangeFilterValue | undefined;
  orientation: GallerySearch['orientation'];
  origin: GallerySearch['origin'];
};

const EMPTY_FILTERS: GalleryFilterValues = {
  keyword: undefined,
  tag: undefined,
  date: undefined,
  orientation: undefined,
  origin: undefined,
};

const ORIENTATION_LABEL_KEY = {
  landscape: 'gallery.filter.landscape',
  portrait: 'gallery.filter.portrait',
  square: 'gallery.filter.square',
} as const satisfies Record<(typeof GALLERY_ORIENTATIONS)[number], string>;

/** 篩選面板的值 → 網址的欄位（日期區間拆回 `from`／`to`）。 */
export function searchOfFilters(values: GalleryFilterValues): Partial<GallerySearch> {
  return {
    keyword: values.keyword,
    tag: values.tag?.length ? values.tag : undefined,
    from: values.date?.from || undefined,
    to: values.date?.to || undefined,
    orientation: values.orientation,
    origin: values.origin,
  };
}

/**
 * 篩選面板（與檔案管理、其他列表頁相同的 `FilterBar`）：標籤、圖片日期、方向、來源，送出時一次寫進網址。
 * 關鍵字由工具列常駐的搜尋框輸入，仍保留在 value 裡：面板送出與移除條件時一起帶上。
 */
export function useGalleryFilters(
  search: GallerySearch,
  onSearchChange: (patch: Partial<GallerySearch>) => void,
  /** `gallery` 標籤組的標籤；還沒載入或沒有任何標籤時不顯示標籤篩選。 */
  tags: readonly Tag[] = [],
): FilterBarProps<GalleryFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      keyword: search.keyword,
      tag: search.tag,
      date: search.from || search.to ? { from: search.from, to: search.to } : undefined,
      orientation: search.orientation,
      origin: search.origin,
    },
    defaultValue: EMPTY_FILTERS,
    onSubmit: (values) => onSearchChange(searchOfFilters(values)),
    fields: [
      ...(tags.length
        ? [
            {
              type: 'multiSelect' as const,
              key: 'tag' as const,
              label: t('gallery.filter.tag'),
              options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
            },
          ]
        : []),
      { type: 'dateRange', key: 'date', label: t('gallery.filter.date') },
      {
        type: 'select',
        key: 'orientation',
        label: t('gallery.filter.orientation'),
        allLabel: t('gallery.filter.anyOrientation'),
        options: GALLERY_ORIENTATIONS.map((value) => ({
          value,
          label: t(ORIENTATION_LABEL_KEY[value]),
        })),
      },
      {
        type: 'select',
        key: 'origin',
        label: t('gallery.filter.origin'),
        allLabel: t('gallery.filter.anyOrigin'),
        options: [
          { value: 'upload', label: t('gallery.filter.uploaded') },
          { value: 'added', label: t('gallery.filter.added') },
        ],
      },
    ],
  };
}
