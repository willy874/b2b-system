import { lazy } from 'react';

import { registerFileAction } from '@/core/file';
import type { FileActionCheck, FileActionTarget } from '@/core/file';
import { PermissionKey } from '@/core/permission';

import { GALLERY_CONTENT_TYPES, HEIC_EXTENSION, HEIC_TYPES } from '../constants';
import { GALLERY_LOCALE_SCOPE } from '../locale';

/** 對話框只在按下時才載入（檔案管理器的首屏不帶圖片庫的程式）。 */
const AddToGalleryDialog = lazy(() =>
  import('./AddToGalleryDialog').then((module) => ({ default: module.AddToGalleryDialog })),
);

/**
 * 每個選取的檔案能不能加入：型別（HEIC 另外說明）。
 * 大小在對話框裡以租戶的單檔上限（`GET /gallery/items/uploads` 的 `maxItemSize`）判斷：這裡是同步的、拿不到參數。
 */
export function checkGalleryFile(file: FileActionTarget): FileActionCheck {
  if (HEIC_TYPES.includes(file.contentType) || HEIC_EXTENSION.test(file.name)) {
    return { ok: false, reasonKey: 'gallery.fileAction.heic' };
  }
  if (!GALLERY_CONTENT_TYPES.includes(file.contentType)) {
    return { ok: false, reasonKey: 'gallery.fileAction.notImage' };
  }
  return { ok: true };
}

/**
 * 檔案管理器的「加入圖片庫」（docs/architecture/frontend/24-gallery.md §6）：經 `core/file` 的 `registerFileAction` 登記，
 * 檔案管理器不認識圖片庫、圖片庫也不認識檔案管理（後端 D0）。`gallery` 沒安裝或被停用時按鈕跟著消失。
 */
export function registerGalleryFileAction(): () => void {
  return registerFileAction({
    id: 'gallery.add',
    order: 10,
    labelKey: 'gallery.fileAction.add',
    localeScope: GALLERY_LOCALE_SCOPE,
    icon: 'file-image',
    placement: ['selectionBar', 'lightbox'],
    isAvailable: ({ can }) => can(PermissionKey['gallery:create']),
    check: checkGalleryFile,
    component: AddToGalleryDialog,
  });
}
