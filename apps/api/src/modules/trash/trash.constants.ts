import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import { RESOURCE_TYPE } from '@/core/resource';

/**
 * 回收桶目前支援的資源類型（`GET /trash?type=` 的 enum，OpenAPI 與 SDK 由它產生）。
 * 擁有資源的模組加入回收桶時（R3 角色、R4 檔案）在這裡加一個值，並在 `onModuleInit` 註冊 `TrashHandler`；
 * 列在這裡卻沒有 handler、或 handler 的類型不在這裡，都讓程序啟動失敗（`TrashRegistry`）。
 */
export const TRASH_RESOURCE_TYPES = [
  RESOURCE_TYPE.USER,
  RESOURCE_TYPE.ROLE,
  RESOURCE_TYPE.GROUP,
  RESOURCE_TYPE.FILE,
  RESOURCE_TYPE.FILE_FOLDER,
  RESOURCE_TYPE.ANNOUNCEMENT,
] as const;

export type TrashResourceType = (typeof TRASH_RESOURCE_TYPES)[number];

/**
 * `GET /trash` 的路由宣告：持有其中 **任一個** 就能進入端點（`@RequireAnyPermission`），
 * 實際看得到哪一種由 service 以該類型 handler 的 `permission` 再檢查一次（docs/architecture/backend/14-revisions.md §9.2 D10：能刪就能復原）。
 * 靜態宣告讓 `route-audit` 的總表與沒有任何刪除權限的人的 403（含 `authz.denied` 稽核）都由 guard 處理。
 */
export const TRASH_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSION.USER_DELETE,
  PERMISSION.ROLE_DELETE,
  PERMISSION.GROUP_DELETE,
  // 檔案與資料夾共用：回收桶只看全域的 file:delete（資料夾層級的刪除權不算，13-trash.md §7.4）
  PERMISSION.FILE_DELETE,
  PERMISSION.ANNOUNCEMENT_DELETE,
];

/** 永久刪除一批的筆數：一批一個交易（docs/architecture/backend/14-revisions.md §9.2 D11）。也是一次推播的變更數上限。 */
export const TRASH_PURGE_BATCH_SIZE = 100;
