/**
 * 本專案的資源依賴圖（機制見 `core/cache/resourceGraph.ts`）。
 *
 * 寫入後不要手列 query key，改成宣告「後端改了什麼」：
 *
 *   invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: role.id }]);
 *
 * 規則：
 * - 這是 `apis/` 底下唯一可以 import 各操作 `query.ts` 的檔案；操作資料夾 **不可** 反過來 import 它。
 * - 新增 query 時，把它的 key 放進對應資源的 `collection` 或 `entity`。
 * - 新增衍生關係時，直接宣告到 **來源** 上（不做遞移），並寫出「為什麼」。
 */
import { APPROVAL_DETAIL_QUERY_KEY } from '@/apis/approval/get-approval-detail/query';
import { APPROVAL_LIST_QUERY_KEY } from '@/apis/approval/get-approval-list/query';
import { AUDIT_LOG_DETAIL_QUERY_KEY } from '@/apis/audit-log/get-audit-log-detail/query';
import { AUDIT_LOG_LIST_QUERY_KEY } from '@/apis/audit-log/get-audit-log-list/query';
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { FILE_ACCESS_REQUEST_LIST_QUERY_KEY } from '@/apis/file/get-file-access-requests/query';
import { FILE_DETAIL_QUERY_KEY } from '@/apis/file/get-file-detail/query';
import { FILE_FOLDER_GRANT_LIST_QUERY_KEY } from '@/apis/file/get-file-folder-grants/query';
import { FILE_FOLDER_LIST_QUERY_KEY } from '@/apis/file/get-file-folder-list/query';
import {
  FILE_INFINITE_LIST_QUERY_KEY,
  FILE_LIST_ANY_FOLDER,
  FILE_LIST_QUERY_KEY,
} from '@/apis/file/get-file-list/query';
import { IDENTITY_PROVIDER_LIST_QUERY_KEY } from '@/apis/identity-provider/get-identity-provider-list/query';
import { JOB_DETAIL_QUERY_KEY } from '@/apis/job/get-job-detail/query';
import { JOB_LIST_QUERY_KEY } from '@/apis/job/get-job-list/query';
import { JOB_QUEUE_LIST_QUERY_KEY } from '@/apis/job/get-job-queue-list/query';
import { PERMISSION_LIST_QUERY_KEY } from '@/apis/permission/get-permission-list/query';
import { ROLE_DETAIL_QUERY_KEY } from '@/apis/role/get-role-detail/query';
import { ROLE_LIST_QUERY_KEY, ROLE_OPTIONS_QUERY_KEY } from '@/apis/role/get-role-list/query';
import { ROLE_PERMISSIONS_QUERY_KEY } from '@/apis/role/get-role-permissions/query';
import { ROLE_REVISION_DETAIL_QUERY_KEY } from '@/apis/role/get-role-revision/query';
import { ROLE_REVISIONS_QUERY_KEY } from '@/apis/role/get-role-revisions/query';
import { ROLE_USERS_QUERY_KEY } from '@/apis/role/get-role-users/query';
import { PUBLIC_SETTINGS_QUERY_KEY } from '@/apis/system/get-public-settings/query';
import { SETTING_LIST_QUERY_KEY } from '@/apis/system/get-setting-list/query';
import { TRASH_LIST_QUERY_KEY } from '@/apis/trash/get-trash-list/query';
import { USER_DETAIL_QUERY_KEY } from '@/apis/user/get-user-detail/query';
import { USER_LIST_QUERY_KEY } from '@/apis/user/get-user-list/query';
import { USER_ROLES_QUERY_KEY } from '@/apis/user/get-user-roles/query';
import { ANY_ID, createResourceGraph, queryClient } from '@/core/cache';
import type { ApplyInvalidationOptions, ResourceChange } from '@/core/cache';
import type { Profile } from '@/shared/api-sdk';
import type { ChangeSource } from '@/shared/websocket-sdk';

export const Resource = {
  // 實體
  USER: 'user',
  ROLE: 'role',
  PERMISSION: 'permission',
  AUDIT_LOG: 'auditLog',
  /** 審批請求（`id` = 請求 id） */
  APPROVAL: 'approval',
  /** 檔案（`id` = 檔案 id） */
  FILE: 'file',
  /** 檔案管理器的資料夾（`id` = 資料夾 id） */
  FILE_FOLDER: 'fileFolder',
  /** 背景工作（`id` = 工作 id） */
  JOB: 'job',
  /** 外部 IdP 連線（`id` = 連線 id）；只有本分頁與其他分頁會失效，後端沒有推播 */
  IDENTITY_PROVIDER: 'identityProvider',
  /** 系統設定（`id` = 設定的 key） */
  SETTING: 'setting',
  /** 目前登入者的 session 視角（profile ＋ 有效權限） */
  PROFILE: 'profile',
  /** 回收桶（已刪除的項目）；後端沒有這個來源，由各資源的建立（還原）與刪除衍生 */
  TRASH: 'trash',
  /** 角色的版本歷史（`id` = roleId）；後端沒有這個來源，由角色與它的權限鍵的更新衍生 */
  ROLE_REVISION: 'roleRevision',
  // 關係：沒有自己的 query，只作為來源
  /** 使用者 ↔ 角色（`id` = userId，`refs.role` = 新舊角色） */
  USER_ROLE: 'userRole',
  /** 角色 ↔ 權限（`id` = roleId） */
  ROLE_PERMISSION: 'rolePermission',
  /** 密碼、邀請等不出現在任何畫面上的憑證寫入（`id` = userId） */
  USER_CREDENTIAL: 'userCredential',
  /** 平台管理者變更了這個租戶啟用的 feature（docs/adr/0021-runtime-feature-activation.md D8） */
  TENANT_FEATURE: 'tenantFeature',
  /**
   * 站內通知（`id` = 通知 id；docs/adr/0026-notification-center.md D8）。後端只推給收件人。
   * 列表與未讀數的 query 在 N2（features/notification）加進依賴圖。
   */
  NOTIFICATION: 'notification',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

/**
 * 編譯期檢查：伺服器推來的每個來源（`ChangeSource`）都必須是 `Resource` 的成員。
 * 後端在合約新增來源而這裡沒跟上時編譯失敗，而不是推播進來後依賴圖查不到規則。
 * `Resource` 是超集：`profile` 這類以登入者為視角的衍生只存在於前端。
 */
type AssertServerSources<T extends Resource> = T;
export type ServerChangeSource = AssertServerSources<ChangeSource>;

export type ResourceChangeEvent = ResourceChange<Resource>;

function cachedProfile(): Profile | undefined {
  return queryClient.getQueryData<Profile>([AUTH_PROFILE_QUERY_KEY]);
}

/** 沒有快取可判斷時一律視為「是」：profile 只有一個 query，寧可多抓一次。 */
function isSelf(change: ResourceChangeEvent): boolean {
  const profile = cachedProfile();
  return !profile || change.id === undefined || change.id === profile.user.id;
}

function selfHoldsRole(change: ResourceChangeEvent): boolean {
  const profile = cachedProfile();
  if (!profile || change.id === undefined || change.id === ANY_ID) return true;
  return profile.roles.some((role) => role.id === change.id);
}

const graph = createResourceGraph<Resource>({
  [Resource.USER]: {
    collection: [USER_LIST_QUERY_KEY],
    entity: [USER_DETAIL_QUERY_KEY, USER_ROLES_QUERY_KEY],
    derivesFrom: [
      // 使用者列表／詳情嵌入了角色摘要
      { from: Resource.USER_ROLE, id: 'self' },
      // 角色改名或被刪，持有它的使用者畫面要更新；角色端不知道是哪些人
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'ref' },
    ],
  },
  [Resource.ROLE]: {
    collection: [ROLE_LIST_QUERY_KEY, ROLE_OPTIONS_QUERY_KEY],
    entity: [ROLE_DETAIL_QUERY_KEY, ROLE_PERMISSIONS_QUERY_KEY, ROLE_USERS_QUERY_KEY],
    derivesFrom: [
      // permissionCount 與權限清單
      { from: Resource.ROLE_PERMISSION, id: 'self' },
      // userCount 與持有者清單
      { from: Resource.USER_ROLE, id: 'ref' },
      // 新增（帶角色）／刪除使用者改變 userCount；更新改變持有者清單上的名稱與狀態
      { from: Resource.USER, id: 'ref' },
    ],
  },
  [Resource.IDENTITY_PROVIDER]: {
    collection: [IDENTITY_PROVIDER_LIST_QUERY_KEY],
  },
  [Resource.SETTING]: {
    // 公開設定是同一批值的子集
    collection: [SETTING_LIST_QUERY_KEY, PUBLIC_SETTINGS_QUERY_KEY],
  },
  [Resource.PERMISSION]: {
    // 權限目錄在一個部署版本內不會變，沒有任何來源
    collection: [PERMISSION_LIST_QUERY_KEY],
  },
  [Resource.AUDIT_LOG]: {
    collection: [AUDIT_LOG_LIST_QUERY_KEY],
    entity: [AUDIT_LOG_DETAIL_QUERY_KEY],
    // 任何寫入都會產生稽核紀錄；既有紀錄不可變，所以只影響列表
    derivesFromAnyChange: true,
  },
  [Resource.APPROVAL]: {
    collection: [APPROVAL_LIST_QUERY_KEY],
    entity: [APPROVAL_DETAIL_QUERY_KEY],
  },
  [Resource.JOB]: {
    // 佇列計數跟著工作的狀態走：重試一筆，失敗數就少一
    collection: [JOB_LIST_QUERY_KEY, JOB_QUEUE_LIST_QUERY_KEY],
    entity: [JOB_DETAIL_QUERY_KEY],
  },
  [Resource.FILE]: {
    // 檔案內容（FILE_TEXT_QUERY_KEY）刻意不列：內容以 id 為 key、上傳後不可變，改名不必重抓；
    // 刪除後 LightBox 由詳情的 404 得知
    collection: [FILE_LIST_QUERY_KEY, FILE_INFINITE_LIST_QUERY_KEY],
    // 推播帶 `refs.fileFolder`（所在的資料夾）：只重抓正在看那個資料夾與不分資料夾的列表，
    // 其他資料夾的檔案管理器不動
    scopedCollection: {
      keys: [FILE_LIST_QUERY_KEY, FILE_INFINITE_LIST_QUERY_KEY],
      ref: Resource.FILE_FOLDER,
      unscoped: FILE_LIST_ANY_FOLDER,
    },
    entity: [FILE_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 遞迴刪除資料夾時其中的檔案一起消失；移動資料夾讓「目前資料夾」的列表內容改變
      { from: Resource.FILE_FOLDER, kinds: ['update', 'delete'], id: 'none' },
    ],
  },
  [Resource.FILE_FOLDER]: {
    // 只有一個扁平清單：樹、麵包屑、主區塊的資料夾都由它組出來。
    // 授權清單含繼承自上層的授權、移動資料夾會改變繼承鏈：一律跟著資料夾失效
    // 存取申請的送出與審核也以 fileFolder update 推出（§6.5）
    collection: [
      FILE_FOLDER_LIST_QUERY_KEY,
      FILE_FOLDER_GRANT_LIST_QUERY_KEY,
      FILE_ACCESS_REQUEST_LIST_QUERY_KEY,
    ],
  },
  [Resource.PROFILE]: {
    collection: [AUTH_PROFILE_QUERY_KEY],
    derivesFrom: [
      { from: Resource.USER, kinds: ['update'], id: 'none', when: isSelf },
      { from: Resource.USER_ROLE, id: 'none', when: isSelf },
      // 自己持有的角色改名、被刪或權限被改，有效權限可能變了
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'none', when: selfHoldsRole },
      { from: Resource.ROLE_PERMISSION, id: 'none', when: selfHoldsRole },
      // profile 帶著啟用的 feature 清單；重新取得後由 useSyncFeatures 安裝或卸載
      { from: Resource.TENANT_FEATURE, id: 'none' },
    ],
  },
  [Resource.TRASH]: {
    collection: [TRASH_LIST_QUERY_KEY],
    derivesFrom: [
      // 刪除＝進回收桶；還原以 create 宣告（重新出現在列表）；永久刪除以 delete 推播
      { from: Resource.USER, kinds: ['create', 'delete'], id: 'none' },
      // 角色同理（ADR-0025 R3）；還原的持有者由伺服器另外推 userRole update（本人的 profile 跟著失效）
      { from: Resource.ROLE, kinds: ['create', 'delete'], id: 'none' },
      // 檔案與資料夾同理（ADR-0025 R4）：上傳完成也是 file create，多一次回收桶的重抓無害
      { from: Resource.FILE, kinds: ['create', 'delete'], id: 'none' },
      { from: Resource.FILE_FOLDER, kinds: ['create', 'delete'], id: 'none' },
    ],
  },
  [Resource.ROLE_REVISION]: {
    entity: [ROLE_REVISIONS_QUERY_KEY, ROLE_REVISION_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 改名稱或說明、還原到某一版都產生新的一版（ADR-0025 R5）；持有者的變更不在快照裡，不影響
      { from: Resource.ROLE, kinds: ['update'], id: 'self' },
      // 增減權限鍵也產生新的一版
      { from: Resource.ROLE_PERMISSION, id: 'self' },
    ],
  },
  [Resource.USER_ROLE]: {},
  [Resource.ROLE_PERMISSION]: {},
  [Resource.USER_CREDENTIAL]: {},
  [Resource.TENANT_FEATURE]: {},
  [Resource.NOTIFICATION]: {},
});

/** 登入者改了自己的資料（profile / 偏好）：對系統而言就是一筆 user 更新。 */
export function selfUpdated(profile: Profile): ResourceChangeEvent {
  return {
    resource: Resource.USER,
    kind: 'update',
    id: profile.user.id,
    refs: { role: profile.roles.map((role) => role.id) },
  };
}

/** 依依賴圖換算出要失效的 query，套用到本分頁並廣播給其他分頁。 */
export function invalidateResources(changes: readonly ResourceChangeEvent[]): void {
  queryClient.broadcastInvalidation(graph.resolve(changes));
}

/**
 * 推播轉來的變更：只在本分頁套用。其他分頁會經 leader 分頁各自收到，不需要再轉給它們
 * （呼叫 `invalidateResources()` 會又經 BroadcastChannel 廣播，讓其他分頁失效兩次）。
 * 背景分頁以 `{ refetch: false }` 只標 stale（docs/architecture/frontend/11-realtime.md §4）。
 */
export function applyResourceChanges(
  changes: readonly ResourceChangeEvent[],
  options?: ApplyInvalidationOptions,
): void {
  queryClient.applyInvalidation(graph.resolve(changes), options);
}

/** 供測試檢查換算結果，不觸發任何失效。 */
export function resolveResourceChanges(changes: readonly ResourceChangeEvent[]) {
  return graph.resolve(changes);
}
