import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { GalleryRoute } from './routes/pages';

/** 圖片庫（含相簿頁 `/gallery/album/$albumId`：前綴命中同一個 page key）。 */
export const GALLERY_PAGE = definePageKey('GALLERY');

export function registerGalleryPagePermissions(): void {
  // 不帶 `resource`：create／update／delete 由 `useGalleryPermission` 直接以權限鍵判斷
  registerPagePermission(GALLERY_PAGE, {
    route: routeBasePath(GalleryRoute), // '/gallery'
    rule: { access: [PermissionKey['gallery:read']], match: PermissionMatch.EVERY },
  });
}
