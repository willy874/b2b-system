import { create } from '@b2b-system/web-shared/hooks';
import { createDictStorage } from '@b2b-system/web-shared/storage';

import { GALLERY_ROW_HEIGHTS } from '../../constants';
import type { GalleryRowHeight } from '../../constants';

/** 排版：等高排列或正方形方格。 */
export type GalleryLayout = 'justified' | 'square';
/** 依日期分組：日、月或不分組。 */
export type GalleryGrouping = 'day' | 'month' | 'none';

export interface GalleryViewPreference {
  layout: GalleryLayout;
  rowHeight: GalleryRowHeight;
  grouping: GalleryGrouping;
}

export const DEFAULT_GALLERY_VIEW: GalleryViewPreference = {
  layout: 'justified',
  rowHeight: 180,
  grouping: 'day',
};

const KEY = 'view';
const storage = createDictStorage('gallery-view');

/** localStorage 裡的值不可信任（舊版本、手改）：逐欄檢查，不合法的欄位退回預設值。 */
export function parseGalleryViewPreference(value: unknown): GalleryViewPreference {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    layout:
      record.layout === 'square' || record.layout === 'justified'
        ? record.layout
        : DEFAULT_GALLERY_VIEW.layout,
    rowHeight: (GALLERY_ROW_HEIGHTS as readonly unknown[]).includes(record.rowHeight)
      ? (record.rowHeight as GalleryRowHeight)
      : DEFAULT_GALLERY_VIEW.rowHeight,
    grouping:
      record.grouping === 'day' || record.grouping === 'month' || record.grouping === 'none'
        ? record.grouping
        : DEFAULT_GALLERY_VIEW.grouping,
  };
}

export interface GalleryViewPreferenceStore extends GalleryViewPreference {
  update: (patch: Partial<GalleryViewPreference>) => void;
}

/** 排版、縮放級別、分組：這台裝置的版面偏好，記在 localStorage（docs/architecture/frontend/24-gallery.md §3）。 */
export const useGalleryViewPreference = create<GalleryViewPreferenceStore>((set, get) => ({
  ...parseGalleryViewPreference(storage.get<unknown>(KEY, undefined)),
  update: (patch) => {
    const { update: _update, ...current } = get();
    const next = parseGalleryViewPreference({ ...current, ...patch });
    storage.set(KEY, next);
    set(next);
  },
}));
