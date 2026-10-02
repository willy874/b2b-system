import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { TrashListRoute } from './routes/pages';

export const TRASH_PAGE = definePageKey('TRASH');

/**
 * 能進回收桶頁＝至少能刪除其中一種資源（ADR-0025 D10）；看得到哪些分頁再依各類型登記的權限過濾
 * （`useTrashPermission`）。與後端 `GET /trash` 的 `TRASH_PERMISSIONS` 是同一組鍵：新的類型加入回收桶時兩邊一起加。
 */
export const TRASH_PAGE_PERMISSIONS: PermissionKey[] = [
  PermissionKey['user:delete'],
  PermissionKey['role:delete'],
  PermissionKey['group:delete'],
  PermissionKey['file:delete'],
  PermissionKey['announcement:delete'],
];

export function registerTrashPagePermissions(): void {
  registerPagePermission(TRASH_PAGE, {
    route: routeBasePath(TrashListRoute),
    rule: { access: TRASH_PAGE_PERMISSIONS, match: PermissionMatch.SOME },
  });
}
