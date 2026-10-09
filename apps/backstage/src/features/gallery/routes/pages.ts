import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { GALLERY_LOCALE_SCOPE } from '../locale';
import { GallerySearchSchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/backend/26-gallery.md §11）。 */
export const GALLERY_FEATURE = 'gallery';

/** 整個圖片庫（時間軸）。 */
export const GalleryRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/gallery',
  staticData: { titleKey: 'menu.gallery' },
  beforeLoad: requireFeature(GALLERY_FEATURE),
  loader: localeScopeLoader(GALLERY_LOCALE_SCOPE),
  validateSearch: GallerySearchSchema,
});

/** 相簿頁：就是套了 `albumId` 篩選的同一個列表（docs/architecture/frontend/24-gallery.md §5）。 */
export const GalleryAlbumRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/gallery/album/$albumId',
  staticData: { titleKey: 'menu.gallery' },
  beforeLoad: requireFeature(GALLERY_FEATURE),
  loader: localeScopeLoader(GALLERY_LOCALE_SCOPE),
  validateSearch: GallerySearchSchema,
});
