import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { GALLERY_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接比對權限鍵（docs/architecture/frontend/24-gallery.md §8）。
 * 授權只有 RBAC（後端 D4）：`gallery:read` 看得到整個圖片庫。權限還沒水合時全部為 false：按鈕不會先出現再消失。
 */
export function useGalleryPermission() {
  const page = usePagePermission(GALLERY_PAGE);
  const { can, hydrated } = usePermission();
  return useMemo(
    () => ({
      ...page,
      canRead: hydrated && can(PermissionKey['gallery:read']),
      /** 上傳、從其他來源加入、建立相簿 */
      canCreate: hydrated && can(PermissionKey['gallery:create']),
      /** 標題、說明、顯示方向、標籤；相簿的改名、封面、加入與移出圖片 */
      canUpdate: hydrated && can(PermissionKey['gallery:update']),
      /** 刪除圖片與相簿（進回收桶） */
      canDelete: hydrated && can(PermissionKey['gallery:delete']),
    }),
    [page, can, hydrated],
  );
}
