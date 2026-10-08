import { ANY_ID, createResourceGraph, queryClient } from '@b2b-system/web-core/cache';
import type { ApplyInvalidationOptions, ResourceChange } from '@b2b-system/web-core/cache';

import { ANNOUNCEMENT_DETAIL_QUERY_KEY } from '@/apis/announcement/get-announcement-detail/query';
import { ANNOUNCEMENT_DISPATCHES_QUERY_KEY } from '@/apis/announcement/get-announcement-dispatches/query';
import { ANNOUNCEMENT_LIST_QUERY_KEY } from '@/apis/announcement/get-announcement-list/query';
import { MY_API_TOKENS_QUERY_KEY } from '@/apis/api-token/get-my-api-tokens/query';
import { USER_API_TOKENS_QUERY_KEY } from '@/apis/api-token/get-user-api-tokens/query';
import { APPROVAL_FLOW_DETAIL_QUERY_KEY } from '@/apis/approval-flow/get-approval-flow-detail/query';
import { APPROVAL_FLOW_LIST_QUERY_KEY } from '@/apis/approval-flow/get-approval-flow-list/query';
/**
 * 本專案的資源依賴圖（機制見 `web-core/cache/resourceGraph.ts`）。
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
import { COMMENT_LIST_QUERY_KEY } from '@/apis/comment/get-comment-list/query';
import { DATA_TRANSFER_LIST_QUERY_KEY } from '@/apis/data-transfer/get-transfer-list/query';
import { DATA_TRANSFER_ROWS_QUERY_KEY } from '@/apis/data-transfer/get-transfer-rows/query';
import { DATA_TRANSFER_DETAIL_QUERY_KEY } from '@/apis/data-transfer/get-transfer/query';
import { FILE_ACCESS_REQUEST_LIST_QUERY_KEY } from '@/apis/file/get-file-access-requests/query';
import { FILE_DETAIL_QUERY_KEY } from '@/apis/file/get-file-detail/query';
import { FILE_FOLDER_EXPLAIN_QUERY_KEY } from '@/apis/file/get-file-folder-explain/query';
import { FILE_FOLDER_GRANT_LIST_QUERY_KEY } from '@/apis/file/get-file-folder-grants/query';
import { FILE_FOLDER_LIST_QUERY_KEY } from '@/apis/file/get-file-folder-list/query';
import {
  FILE_INFINITE_LIST_QUERY_KEY,
  FILE_LIST_ANY_FOLDER,
  FILE_LIST_QUERY_KEY,
} from '@/apis/file/get-file-list/query';
import { FILE_STORAGE_USAGE_QUERY_KEY } from '@/apis/file/get-upload-policy/query';
import { GROUP_DETAIL_QUERY_KEY } from '@/apis/group/get-group-detail/query';
import { GROUP_LIST_QUERY_KEY, GROUP_OPTIONS_QUERY_KEY } from '@/apis/group/get-group-list/query';
import { GROUP_MEMBERS_QUERY_KEY } from '@/apis/group/get-group-members/query';
import { GROUP_ROLES_QUERY_KEY } from '@/apis/group/get-group-roles/query';
import { IDENTITY_PROVIDER_LIST_QUERY_KEY } from '@/apis/identity-provider/get-identity-provider-list/query';
import { JOB_DETAIL_QUERY_KEY } from '@/apis/job/get-job-detail/query';
import { JOB_LIST_QUERY_KEY } from '@/apis/job/get-job-list/query';
import { JOB_QUEUE_LIST_QUERY_KEY } from '@/apis/job/get-job-queue-list/query';
import { NOTIFICATION_EVENT_LIST_QUERY_KEY } from '@/apis/notification/get-notification-event-list/query';
import { NOTIFICATION_LIST_QUERY_KEY } from '@/apis/notification/get-notification-list/query';
import { NOTIFICATION_OVERVIEW_QUERY_KEY } from '@/apis/notification/get-notification-overview/query';
import { NOTIFICATION_PREFERENCE_LIST_QUERY_KEY } from '@/apis/notification/get-notification-preference-list/query';
import { NOTIFICATION_UNREAD_COUNT_QUERY_KEY } from '@/apis/notification/get-notification-unread-count/query';
import { ORG_UNIT_DETAIL_QUERY_KEY } from '@/apis/org-unit/get-org-unit-detail/query';
import { ORG_UNIT_MEMBERS_QUERY_KEY } from '@/apis/org-unit/get-org-unit-members/query';
import { ORG_UNIT_TREE_QUERY_KEY } from '@/apis/org-unit/get-org-unit-tree/query';
import { USER_ORG_UNITS_QUERY_KEY } from '@/apis/org-unit/get-user-org-units/query';
import { PERMISSION_LIST_QUERY_KEY } from '@/apis/permission/get-permission-list/query';
import { ROLE_DETAIL_QUERY_KEY } from '@/apis/role/get-role-detail/query';
import { ROLE_LIST_QUERY_KEY, ROLE_OPTIONS_QUERY_KEY } from '@/apis/role/get-role-list/query';
import { ROLE_PERMISSIONS_QUERY_KEY } from '@/apis/role/get-role-permissions/query';
import { ROLE_REVISION_DETAIL_QUERY_KEY } from '@/apis/role/get-role-revision/query';
import { ROLE_REVISIONS_QUERY_KEY } from '@/apis/role/get-role-revisions/query';
import { ROLE_USERS_QUERY_KEY } from '@/apis/role/get-role-users/query';
import { SERVICE_ACCOUNT_DETAIL_QUERY_KEY } from '@/apis/service-account/get-service-account-detail/query';
import { SERVICE_ACCOUNT_LIST_QUERY_KEY } from '@/apis/service-account/get-service-account-list/query';
import { SERVICE_ACCOUNT_TOKENS_QUERY_KEY } from '@/apis/service-account/get-service-account-tokens/query';
import { PUBLIC_SETTINGS_QUERY_KEY } from '@/apis/system/get-public-settings/query';
import { SETTING_LIST_QUERY_KEY } from '@/apis/system/get-setting-list/query';
import { TAG_LIST_QUERY_KEY } from '@/apis/tag/get-tag-list/query';
import { TRASH_LIST_QUERY_KEY } from '@/apis/trash/get-trash-list/query';
import { USER_DETAIL_QUERY_KEY } from '@/apis/user/get-user-detail/query';
import { USER_LIST_QUERY_KEY } from '@/apis/user/get-user-list/query';
import { PERMISSION_SOURCES_QUERY_KEY } from '@/apis/user/get-user-permission-sources/query';
import { WATCH_STATE_QUERY_KEY } from '@/apis/watch/get-watch-state/query';
import { WEBHOOK_DELIVERIES_QUERY_KEY } from '@/apis/webhook/get-webhook-deliveries/query';
import { WEBHOOK_DETAIL_QUERY_KEY } from '@/apis/webhook/get-webhook-detail/query';
import { WEBHOOK_LIST_QUERY_KEY } from '@/apis/webhook/get-webhook-list/query';
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
  /**
   * 授權的說明：有效權限的來源、資料夾存取的路徑（docs/architecture/iam/01-model.md §9 G4b）。後端沒有這個來源；路徑經過使用者、群組、角色、資料夾，
   * 由它們的任何變更衍生。只在展開說明時才查，整批失效的成本小
   */
  AUTHZ_EXPLAIN: 'authzExplain',
  /** 角色的版本歷史（`id` = roleId）；後端沒有這個來源，由角色與它的權限鍵的更新衍生 */
  ROLE_REVISION: 'roleRevision',
  /**
   * 檔案的容量與已用量（docs/architecture/05-tenancy.md §13.3 D8）；後端沒有這個來源。刻意 **不** 跟著 `file` 失效：
   * 任何人的每一次檔案變動都推給所有開著檔案管理的人，跟著重抓等於「推播數 × 分頁數」次 upload-policy。
   * 只在自己的上傳結束時宣告（登記就佔用了容量）；別人造成的變化等 staleTime 過後、切回分頁時重抓。
   */
  FILE_STORAGE_USAGE: 'fileStorageUsage',
  // 關係：沒有自己的 query，只作為來源
  /** 使用者 ↔ 角色（`id` = userId，`refs.role` = 新舊角色） */
  USER_ROLE: 'userRole',
  /** 角色 ↔ 權限（`id` = roleId） */
  ROLE_PERMISSION: 'rolePermission',
  /** 群組（`id` = 群組 id；名稱、成員、持有的角色都以它宣告，docs/architecture/iam/01-model.md §9.3 D11） */
  GROUP: 'group',
  /** 密碼、邀請等不出現在任何畫面上的憑證寫入（`id` = userId） */
  USER_CREDENTIAL: 'userCredential',
  /** 平台管理者變更了這個租戶啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8） */
  TENANT_FEATURE: 'tenantFeature',
  /**
   * 站內通知（`id` = 通知 id；docs/architecture/backend/15-notification.md §12.2 D8）。後端只推給收件人自己，
   * 新通知是 create、已讀與全部已讀是 update。
   */
  NOTIFICATION: 'notification',
  /** 事件管理的租戶政策（`id` = 事件類型；docs/architecture/backend/16-notification-event.md §9.2 D9） */
  NOTIFICATION_POLICY: 'notificationPolicy',
  /** 自己的通知設定（`id` = 事件類型；後端只推給本人，docs/architecture/backend/16-notification-event.md §9.2 D15） */
  NOTIFICATION_PREFERENCE: 'notificationPreference',
  /** 服務帳號（`id` = 服務帳號 id；docs/architecture/06-external-api.md §9.2 D1） */
  SERVICE_ACCOUNT: 'serviceAccount',
  /**
   * API token（`id` = token id）：個人的、別人的、服務帳號的都是它。撤銷以 update 宣告（還在列表上，狀態變了）；
   * 服務帳號的 token 帶 `refs.serviceAccount`（擁有者的有效 token 數）
   */
  API_TOKEN: 'apiToken',
  /** Webhook 訂閱（`id` = 訂閱 id；docs/architecture/backend/17-webhook.md §9） */
  WEBHOOK: 'webhook',
  /** 一次投遞嘗試（`id` = 紀錄 id）；帶 `refs.webhook`。投遞不寫稽核 */
  WEBHOOK_DELIVERY: 'webhookDelivery',
  /**
   * 標籤的定義（`id` = 標籤 id；docs/architecture/backend/18-tag.md §7.2 D10）。貼與移除以擁有者的資源宣告（`file`、`fileFolder`、`user` update）
   */
  TAG: 'tag',
  /**
   * 公告（`id` = 公告 id；docs/architecture/backend/19-announcement.md §9）。背景發送的狀態、撤回也以它的 update 宣告，
   * 詳情的發送紀錄跟著重抓
   */
  ANNOUNCEMENT: 'announcement',
  /**
   * 匯入匯出的傳輸（`id` = 傳輸 id；docs/architecture/backend/22-data-transfer.md §9.4）：只推給建立者，進度推播不寫稽核
   */
  DATA_TRANSFER: 'dataTransfer',
  /**
   * 組織的部門（`id` = 部門 id；docs/architecture/backend/23-organization.md）：結構與成員都以它宣告。
   * 被異動的成員本人由後端以 user room 推送（使用者詳情的「所屬部門」）。
   */
  ORG_UNIT: 'orgUnit',
  /** 審批流程的設定（`id` = 審批類型；docs/architecture/backend/20-approval.md §9）。 */
  APPROVAL_FLOW: 'approvalFlow',
  /**
   * 資源上的留言（`id` = 留言 id，`refs` 帶所在的資源；docs/architecture/backend/24-comment.md §5）。
   * 只有管理者刪別人的留言寫稽核，其餘不寫
   */
  COMMENT: 'comment',
  /** 自己對某個資源的關注（`id` = 資源 id）：後端只推給本人，關注不寫稽核 */
  WATCH: 'watch',
  /**
   * 平台的來源（租戶登記、平台管理者、全平台 flag、平台的背景工作與通知）：後端只推給 apps/platform 的連線
   * （docs/architecture/backend/08-realtime.md §3.6），backstage 永遠收不到；列在這裡只為了滿足 `ServerChangeSource` 的檢查。
   */
  PLATFORM_TENANT: 'platformTenant',
  PLATFORM_ADMIN: 'platformAdmin',
  PLATFORM_FEATURE_FLAG: 'platformFeatureFlag',
  PLATFORM_JOB: 'platformJob',
  PLATFORM_NOTIFICATION: 'platformNotification',
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
    entity: [USER_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 使用者列表／詳情嵌入了角色摘要
      { from: Resource.USER_ROLE, id: 'self' },
      // 角色改名或被刪，持有它的使用者畫面要更新；角色端不知道是哪些人
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'ref' },
      // 列表與詳情嵌入標籤的名稱與顏色；標籤端不知道貼在哪些人身上
      { from: Resource.TAG, kinds: ['update', 'delete'], id: 'none' },
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
  [Resource.NOTIFICATION_POLICY]: {
    collection: [NOTIFICATION_EVENT_LIST_QUERY_KEY],
  },
  [Resource.NOTIFICATION_PREFERENCE]: {
    collection: [NOTIFICATION_PREFERENCE_LIST_QUERY_KEY],
    // 能不能調整、跟著租戶的值都來自租戶的政策。政策的推播只到 system:read 的人，其他人在下次進偏好頁時重抓
    derivesFrom: [{ from: Resource.NOTIFICATION_POLICY, id: 'none' }],
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
    // 任何寫入都會產生稽核紀錄；既有紀錄不可變，所以只影響列表。
    // 站內通知不寫稽核（docs/architecture/backend/15-notification.md §12.2 D9），後端也不把它推給 auditLog:read（08-realtime.md §6.1 的 recordsAudit: false）：
    // 收到自己的通知、標為已讀時不重抓稽核列表
    // 已用量（前端自己的宣告）也不是寫入
    derivesFromAnyChange: {
      // 匯入匯出的進度推播只給建立者、不寫稽核（後端的 recordsAudit: false）
      except: [
        Resource.NOTIFICATION,
        Resource.WEBHOOK_DELIVERY,
        Resource.FILE_STORAGE_USAGE,
        Resource.DATA_TRANSFER,
        Resource.COMMENT,
        Resource.WATCH,
      ],
    },
  },
  [Resource.APPROVAL]: {
    collection: [APPROVAL_LIST_QUERY_KEY],
    entity: [APPROVAL_DETAIL_QUERY_KEY],
  },
  [Resource.APPROVAL_FLOW]: {
    collection: [APPROVAL_FLOW_LIST_QUERY_KEY],
    entity: [APPROVAL_FLOW_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 規則旁顯示對象的名稱與「已刪除」：使用者、群組、角色、部門改名或刪除時重抓
      { from: Resource.USER, kinds: ['update', 'delete'], id: 'none' },
      { from: Resource.GROUP, kinds: ['update', 'delete'], id: 'none' },
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'none' },
      { from: Resource.ORG_UNIT, kinds: ['update', 'delete'], id: 'none' },
    ],
  },
  [Resource.COMMENT]: {
    // 一次只開著一兩個資源的留言：任何留言的變更都整批重抓（keyset，只抓已載入的頁數）
    collection: [COMMENT_LIST_QUERY_KEY],
    derivesFrom: [
      // 留言嵌入作者與被提及者的名稱
      { from: Resource.USER, kinds: ['update', 'delete'], id: 'none' },
    ],
  },
  [Resource.WATCH]: {
    // key 的第二、三個元素是資源類型與 id，推播的 id 只有資源 id：整批重抓（畫面上通常只有一個）
    collection: [WATCH_STATE_QUERY_KEY],
    derivesFrom: [
      // 留言的作者自動關注：關注人數變了
      { from: Resource.COMMENT, kinds: ['create'], id: 'none' },
    ],
  },
  [Resource.ORG_UNIT]: {
    // 使用者的「所屬部門」以使用者 id 為鍵，部門的變化不知道影響了誰：整批重抓
    collection: [ORG_UNIT_TREE_QUERY_KEY, USER_ORG_UNITS_QUERY_KEY],
    entity: [ORG_UNIT_DETAIL_QUERY_KEY, ORG_UNIT_MEMBERS_QUERY_KEY],
    derivesFrom: [
      // 成員表嵌入使用者的名稱與狀態
      { from: Resource.USER, kinds: ['update', 'delete'], id: 'none' },
    ],
  },
  [Resource.JOB]: {
    // 佇列計數跟著工作的狀態走：重試一筆，失敗數就少一
    collection: [JOB_LIST_QUERY_KEY, JOB_QUEUE_LIST_QUERY_KEY],
    entity: [JOB_DETAIL_QUERY_KEY],
  },
  [Resource.FILE]: {
    // 檔案內容（FILE_TEXT_QUERY_KEY）刻意不列：內容以 id 為 key、上傳後不可變，改名不必重抓；
    // 刪除後 LightBox 由詳情的 404 得知。容量的已用量也不列，見 `Resource.FILE_STORAGE_USAGE`
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
      // 檔案嵌入標籤的名稱與顏色（docs/architecture/backend/18-tag.md §7.2 D6）
      { from: Resource.TAG, kinds: ['update', 'delete'], id: 'none' },
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
    // 資料夾也嵌入標籤
    derivesFrom: [{ from: Resource.TAG, kinds: ['update', 'delete'], id: 'none' }],
  },
  [Resource.TAG]: {
    collection: [TAG_LIST_QUERY_KEY],
  },
  [Resource.FILE_STORAGE_USAGE]: {
    collection: [FILE_STORAGE_USAGE_QUERY_KEY],
  },
  [Resource.PROFILE]: {
    collection: [AUTH_PROFILE_QUERY_KEY],
    derivesFrom: [
      { from: Resource.USER, kinds: ['update'], id: 'none', when: isSelf },
      { from: Resource.USER_ROLE, id: 'none', when: isSelf },
      // 自己持有的角色改名、被刪或權限被改，有效權限可能變了
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'none', when: selfHoldsRole },
      { from: Resource.ROLE_PERMISSION, id: 'none', when: selfHoldsRole },
      // 群組的成員、持有的角色、刪除與還原都可能改變自己的權限；前端不知道自己（間接）在哪些群組裡，
      // 一律重抓（伺服器把群組的變更推給群組的所有成員，docs/architecture/iam/01-model.md §9.3 D11）
      { from: Resource.GROUP, id: 'none' },
      // profile 帶著啟用的 feature 清單；重新取得後由 useSyncFeatures 安裝或卸載
      { from: Resource.TENANT_FEATURE, id: 'none' },
    ],
  },
  [Resource.TRASH]: {
    collection: [TRASH_LIST_QUERY_KEY],
    derivesFrom: [
      // 刪除＝進回收桶；還原以 create 宣告（重新出現在列表）；永久刪除以 delete 推播
      { from: Resource.USER, kinds: ['create', 'delete'], id: 'none' },
      // 角色同理（docs/architecture/backend/14-revisions.md §9 R3）；還原的持有者由伺服器另外推 userRole update（本人的 profile 跟著失效）
      { from: Resource.ROLE, kinds: ['create', 'delete'], id: 'none' },
      // 群組、部門同理（部門的回收桶分頁：features/organization/trash.ts）
      { from: Resource.GROUP, kinds: ['create', 'delete'], id: 'none' },
      { from: Resource.ORG_UNIT, kinds: ['create', 'delete'], id: 'none' },
      { from: Resource.ANNOUNCEMENT, kinds: ['create', 'delete'], id: 'none' },
      // 檔案與資料夾同理（docs/architecture/backend/14-revisions.md §9 R4）：上傳完成也是 file create，多一次回收桶的重抓無害
      { from: Resource.FILE, kinds: ['create', 'delete'], id: 'none' },
      { from: Resource.FILE_FOLDER, kinds: ['create', 'delete'], id: 'none' },
    ],
  },
  [Resource.ROLE_REVISION]: {
    entity: [ROLE_REVISIONS_QUERY_KEY, ROLE_REVISION_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 改名稱或說明、還原到某一版都產生新的一版（docs/architecture/backend/14-revisions.md §9 R5）；持有者的變更不在快照裡，不影響
      { from: Resource.ROLE, kinds: ['update'], id: 'self' },
      // 增減權限鍵也產生新的一版
      { from: Resource.ROLE_PERMISSION, id: 'self' },
    ],
  },
  [Resource.AUTHZ_EXPLAIN]: {
    collection: [PERMISSION_SOURCES_QUERY_KEY, FILE_FOLDER_EXPLAIN_QUERY_KEY],
    derivesFrom: [
      // 建立使用者、角色不會改變任何既有的說明；停用、刪除、改名會
      { from: Resource.USER, kinds: ['update', 'delete'], id: 'none' },
      { from: Resource.USER_ROLE, id: 'none' },
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'none' },
      { from: Resource.ROLE_PERMISSION, id: 'none' },
      { from: Resource.GROUP, id: 'none' },
      { from: Resource.FILE_FOLDER, id: 'none' },
    ],
  },
  [Resource.USER_ROLE]: {},
  [Resource.ROLE_PERMISSION]: {},
  [Resource.GROUP]: {
    collection: [GROUP_LIST_QUERY_KEY, GROUP_OPTIONS_QUERY_KEY],
    entity: [GROUP_DETAIL_QUERY_KEY, GROUP_MEMBERS_QUERY_KEY, GROUP_ROLES_QUERY_KEY],
    derivesFrom: [
      // 成員清單嵌入使用者的名稱與狀態；使用者端不知道在哪些群組裡
      { from: Resource.USER, kinds: ['update', 'delete'], id: 'ref' },
      // 持有的角色清單嵌入角色名稱；角色被刪就從清單消失
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'ref' },
    ],
  },
  [Resource.USER_CREDENTIAL]: {},
  [Resource.TENANT_FEATURE]: {},
  [Resource.PLATFORM_TENANT]: {},
  [Resource.PLATFORM_ADMIN]: {},
  [Resource.PLATFORM_FEATURE_FLAG]: {},
  [Resource.PLATFORM_JOB]: {},
  [Resource.PLATFORM_NOTIFICATION]: {},
  [Resource.SERVICE_ACCOUNT]: {
    collection: [SERVICE_ACCOUNT_LIST_QUERY_KEY],
    entity: [SERVICE_ACCOUNT_DETAIL_QUERY_KEY],
    derivesFrom: [
      // 列表與詳情嵌入角色名稱；角色端不知道哪些服務帳號持有它（沒有 refs），改名與刪除時列表與所有詳情都重抓
      { from: Resource.ROLE, kinds: ['update', 'delete'], id: 'ref' },
      // 有效 token 數
      { from: Resource.API_TOKEN, id: 'ref' },
    ],
  },
  [Resource.API_TOKEN]: {
    // 三種列表都是「某個帳號的全部 token」，數量少，整批重抓
    collection: [
      MY_API_TOKENS_QUERY_KEY,
      USER_API_TOKENS_QUERY_KEY,
      SERVICE_ACCOUNT_TOKENS_QUERY_KEY,
    ],
    derivesFrom: [
      // 停用、刪除服務帳號讓它的 token 全部失效（狀態變成 invalidated／revoked）
      { from: Resource.SERVICE_ACCOUNT, kinds: ['update', 'delete'], id: 'none' },
    ],
  },
  [Resource.WEBHOOK]: {
    collection: [WEBHOOK_LIST_QUERY_KEY],
    // 投遞紀錄的 key 第二個元素是 webhook id：刪除時一併移除
    entity: [WEBHOOK_DETAIL_QUERY_KEY, WEBHOOK_DELIVERIES_QUERY_KEY],
    derivesFrom: [
      // 新的投遞改變最後投遞時間、失敗次數（自動停用另外以 webhook update 宣告）與那個 webhook 的投遞紀錄
      { from: Resource.WEBHOOK_DELIVERY, id: 'ref' },
    ],
  },
  [Resource.WEBHOOK_DELIVERY]: {},
  [Resource.DATA_TRANSFER]: {
    collection: [DATA_TRANSFER_LIST_QUERY_KEY],
    // 套用列的 key 第二個元素是傳輸 id：進度與結果跟著重抓
    entity: [DATA_TRANSFER_DETAIL_QUERY_KEY, DATA_TRANSFER_ROWS_QUERY_KEY],
  },
  [Resource.ANNOUNCEMENT]: {
    collection: [ANNOUNCEMENT_LIST_QUERY_KEY],
    // 發送紀錄的 key 第二個元素是公告 id：刪除時一併移除
    entity: [ANNOUNCEMENT_DETAIL_QUERY_KEY, ANNOUNCEMENT_DISPATCHES_QUERY_KEY],
  },
  [Resource.NOTIFICATION]: {
    // 列表與未讀數都只看自己的：新通知、已讀、全部已讀都會改變兩者。列表只有 collection——
    // 已讀一則也要讓「未讀」篩選的列表少一筆，逐筆更新快取不如整個重抓（keyset，只抓已載入的頁數）
    // 總覽（`notification:read`）也列出自己的通知；後端只推給收件人，別人的通知變化不會讓它失效，重新整理才看得到
    collection: [
      NOTIFICATION_LIST_QUERY_KEY,
      NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
      NOTIFICATION_OVERVIEW_QUERY_KEY,
    ],
  },
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
