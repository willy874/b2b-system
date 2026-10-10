import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { GALLERY_LOCALE_SCOPE } from './locale';

/** 還原按鈕只在回收桶頁渲染：以 `lazy()` 登記，按鈕與它用到的 mutation hook 不進首頁的初始載入（docs/architecture/frontend/13-trash.md）。 */
const GalleryItemRestoreAction = lazy(() =>
  import('./components/GalleryRestoreActions').then((module) => ({
    default: module.GalleryItemRestoreAction,
  })),
);
const GalleryAlbumRestoreAction = lazy(() =>
  import('./components/GalleryRestoreActions').then((module) => ({
    default: module.GalleryAlbumRestoreAction,
  })),
);

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多「圖片庫」「相簿」兩個分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `gallery:delete`，與後端的 `GalleryItemTrashHandler`、`GalleryAlbumTrashHandler` 相同。
 */
export function registerGalleryTrashTypes(): void {
  registerTrashType({
    type: 'galleryItem',
    order: 32,
    labelI18nKey: 'menu.gallery',
    permission: PermissionKey['gallery:delete'],
    localeScope: GALLERY_LOCALE_SCOPE,
    RestoreAction: GalleryItemRestoreAction,
  });
  registerTrashType({
    type: 'galleryAlbum',
    order: 33,
    labelI18nKey: 'menu.galleryAlbum',
    permission: PermissionKey['gallery:delete'],
    localeScope: GALLERY_LOCALE_SCOPE,
    RestoreAction: GalleryAlbumRestoreAction,
  });
}
