import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { FileRestoreAction } from './components/FileRestoreAction';
import { FolderRestoreAction } from './components/FolderRestoreAction';
import { FILE_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多「檔案」與「資料夾」兩個分頁（docs/architecture/frontend/13-trash.md）。
 * 看回收桶要全域的 `file:delete`（ADR-0025 D10），與後端 `FileTrashHandler`／`FileFolderTrashHandler` 的 `permission` 相同；
 * 只有資料夾授權的人由刪除提示的「復原」還原（docs/architecture/backend/13-trash.md §7.4）。
 * 檔案是可在執行期停用的 feature：登記由容器收集，卸載時分頁跟著消失。
 */
export function registerFileTrashTypes(): void {
  registerTrashType({
    type: 'file',
    order: 30,
    labelI18nKey: 'menu.file',
    permission: PermissionKey['file:delete'],
    localeScope: FILE_LOCALE_SCOPE,
    RestoreAction: FileRestoreAction,
  });
  registerTrashType({
    type: 'fileFolder',
    order: 40,
    labelI18nKey: 'menu.fileFolder',
    permission: PermissionKey['file:delete'],
    localeScope: FILE_LOCALE_SCOPE,
    RestoreAction: FolderRestoreAction,
  });
}
