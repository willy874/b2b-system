import { registerImageSource } from '@b2b-system/web-core/image-picker';
import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';

import { GALLERY_LOCALE_SCOPE } from '../locale';

/** 圖片來源的 id（後端的 `GALLERY_IMAGE_SOURCE`）。 */
export const GALLERY_IMAGE_SOURCE_ID = 'gallery';

/** 選圖時才載入。 */
const GalleryImageSource = lazy(() =>
  import('./GalleryImageSource').then((module) => ({ default: module.GalleryImageSource })),
);

/**
 * 圖片庫是圖片的一個來源（docs/architecture/frontend/24-gallery.md §7）：`gallery` feature 的 plugin 在同步階段登記，
 * 沒安裝或被停用（卸載）時「圖片庫」分頁跟著消失。選了之後由伺服器 **複製** 成一張新的圖片資產（後端 D1）。
 */
export function registerGalleryImageSource(): void {
  registerImageSource({
    id: GALLERY_IMAGE_SOURCE_ID,
    order: 25,
    // 分頁標題用 app 的全域字串：feature 的語系包只在進入它的頁面時才載入
    labelKey: 'image.source.gallery',
    localeScope: GALLERY_LOCALE_SCOPE,
    isAvailable: ({ can }) => can(PermissionKey['gallery:read']),
    component: GalleryImageSource,
  });
}
