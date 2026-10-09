import { registerImageSource } from '@b2b-system/web-core/image-picker';
import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';

import { FILE_IMAGE_SOURCE_ID } from '../constants';
import { FILE_LOCALE_SCOPE } from '../locale';

/** 選圖時才載入（檔案的縮圖格不在首屏）。 */
const FileImageSource = lazy(() =>
  import('./FileImageSource').then((module) => ({ default: module.FileImageSource })),
);

/**
 * 檔案管理是圖片的一個來源（docs/architecture/frontend/23-image-picker.md §7）：`file` feature 的 plugin 在同步階段登記，
 * feature 沒安裝或被停用（卸載）時跟著消失。看得到什麼由後端的資料夾授權決定，這裡只看能不能進檔案管理器。
 */
export function registerFileImageSource(): void {
  registerImageSource({
    id: FILE_IMAGE_SOURCE_ID,
    order: 30,
    // 分頁標題用 app 的全域字串：feature 的語系包只在進入它的頁面時才載入（與選單的 `menu.*` 相同）
    labelKey: 'image.source.file',
    localeScope: FILE_LOCALE_SCOPE,
    // 圖片庫的「從其他來源加入」可以一次勾選多張（docs/architecture/frontend/23-image-picker.md §2.1）
    supportsMultiple: true,
    isAvailable: ({ can }) => can(PermissionKey['file:access']) || can(PermissionKey['file:read']),
    component: FileImageSource,
  });
}
