/**
 * 錯誤碼是前後端的穩定契約：api 以 `AppException(ErrorCode.X)` 拋出、`statusOf` 決定 HTTP 狀態；
 * 前端以 `ERROR_MESSAGE_KEY`（`Record<ErrorCode, …>`，漏一個碼就編譯失敗）對到 `error.<CODE>` 的翻譯。
 * 新增一個碼時，同步加上 web-core 的 `ERROR_MESSAGE_KEY`（`web-core/errors/errorMessageKey.ts`）與 web-core 兩個語系檔的
 * `error.<CODE>`（`web-core/locales/__tests__/resources.test.ts` 比對）；兩個 app 不必改。
 *
 * 這個 package 只有常數，不依賴任何東西（api 與瀏覽器都會載入）。
 */
export const ErrorCode = {
  // ── 驗證 ──
  VALIDATION_FAILED: { status: 400 },
  /** 會設定 session cookie 的端點只接受 `application/json`（擋跨站表單送出；docs/architecture/backend/04-auth.md §2.5）。 */
  UNSUPPORTED_MEDIA_TYPE: { status: 415 },

  // ── 租戶（docs/architecture/05-tenancy.md §10.2 D2） ──
  /** 請求的網域不屬於任何租戶（或程式在沒有租戶脈絡的地方存取租戶 DB）。 */
  TENANT_NOT_FOUND: { status: 404 },
  /** 租戶停用、佈建中或佈建失敗。 */
  TENANT_UNAVAILABLE: { status: 503 },
  /** 平台管理者的端點只在 apps/platform 的網域（不屬於任何租戶）提供；租戶網域上等同不存在。 */
  PLATFORM_ONLY: { status: 404 },
  /** 建立租戶：代碼已被使用（未刪除的租戶；D12）。 */
  TENANT_CODE_TAKEN: { status: 409 },
  /** 網域已屬於另一個租戶（一個網域只屬於一個租戶，D2）。 */
  TENANT_DOMAIN_TAKEN: { status: 409 },
  /** 租戶目前的狀態不能做這個動作（例：啟用一個佈建中的租戶、重試一個沒有失敗的佈建）。 */
  TENANT_STATUS_CONFLICT: { status: 409 },
  /** 不能移除租戶的最後一個網域（沒有網域就沒有入口）。 */
  TENANT_LAST_DOMAIN: { status: 409 },
  /** 不能移除租戶的主要網域（信中的連結與「進入租戶」都用它）。 */
  TENANT_PRIMARY_DOMAIN: { status: 409 },
  /** 平台管理者不存在（或已刪除）。 */
  PLATFORM_ADMIN_NOT_FOUND: { status: 404 },
  /**
   * 這個端點屬於租戶沒有啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D11）。
   * 404：不暴露功能存在，與路徑不存在一樣。
   */
  FEATURE_DISABLED: { status: 404 },
  /** 目錄裡沒有這個 feature flag（docs/architecture/05-tenancy.md §11.2 D1）：已移除或拼錯。 */
  FEATURE_FLAG_NOT_FOUND: { status: 404 },

  // ── 認證 ──
  AUTH_INVALID_CREDENTIALS: { status: 401 },
  AUTH_ACCOUNT_PENDING: { status: 401 },
  AUTH_ACCOUNT_DISABLED: { status: 403 },
  AUTH_ACCOUNT_LOCKED: { status: 403 },
  AUTH_TOKEN_INVALID: { status: 401 },
  AUTH_TOKEN_STALE: { status: 401 },
  /** API token 已過期（對外 API，docs/architecture/06-external-api.md §9.2 D8）：要換一把新的。 */
  AUTH_API_TOKEN_EXPIRED: { status: 401 },
  AUTH_REFRESH_INVALID: { status: 401 },
  AUTH_REFRESH_EXPIRED: { status: 401 },
  AUTH_REFRESH_REVOKED: { status: 401 },
  AUTH_REFRESH_REUSED: { status: 401 },
  AUTH_PASSWORD_MISMATCH: { status: 400 },
  AUTH_PASSWORD_WEAK: { status: 400 },
  AUTH_SETUP_TOKEN_INVALID: { status: 400 },
  /** 租戶關閉了註冊申請（設定 `auth.registrationEnabled`）：端點等同不存在。 */
  AUTH_REGISTRATION_DISABLED: { status: 404 },
  /** 登入互動不存在、已過期，或瀏覽器沒有帶互動 cookie（docs/architecture/04-sso.md §12）。 */
  AUTH_SSO_INTERACTION_INVALID: { status: 400 },
  /** 授權碼無效：不存在、已用過、過期、client 或 redirect URI 不符、PKCE 不符（不細分，不洩漏哪一項）。 */
  AUTH_SSO_CODE_INVALID: { status: 400 },
  /** 這個 email 網域只允許 SSO：不能用密碼登入（docs/architecture/04-sso.md §12.2 D9）。 */
  AUTH_SSO_REQUIRED: { status: 403 },
  /** 外部 IdP 登入成功，但沒有對應的帳號，而連線設定為拒絕（D10）。 */
  AUTH_SSO_ACCOUNT_NOT_FOUND: { status: 403 },
  /**
   * 外部 IdP 回報的 email 對上既有帳號，但不能自動連結：email 網域不是這個連線登記的網域，或帳號持有系統的
   * 管理角色（super-admin、admin、auditor）。要由本人以密碼登入，或請管理員處理（docs/architecture/04-sso.md §3.3）。
   */
  AUTH_SSO_LINK_NOT_ALLOWED: { status: 403 },
  /** 外部 IdP 連線不存在、已停用，或無法連線（discovery 失敗）。 */
  AUTH_SSO_PROVIDER_UNAVAILABLE: { status: 400 },
  /** 外部 IdP 回來的結果無效：state 不對、已過期、授權碼兌換失敗、ID token 驗證失敗。 */
  AUTH_SSO_EXTERNAL_FAILED: { status: 400 },
  /**
   * 密碼驗證的名額已滿或等太久（argon2 的並行上限，docs/architecture/backend/04-auth.md §4.1）：稍後再試。
   * `details.retryAfterSeconds` 與 `Retry-After` 是建議的等待秒數。
   */
  AUTH_BUSY: { status: 503 },

  // ── 授權 ──
  AUTHZ_FORBIDDEN: { status: 403 },
  AUTHZ_ESCALATION: { status: 403 },
  AUTHZ_SELF_MODIFY: { status: 403 },
  ROUTE_PERMISSION_NOT_DECLARED: { status: 500 },

  // ── 使用者 ──
  USER_NOT_FOUND: { status: 404 },
  USER_EMAIL_DUPLICATE: { status: 409 },
  USER_USERNAME_DUPLICATE: { status: 409 },
  USER_NOT_LOCKED: { status: 409 },
  /** 整批取代角色時，送出的草稿所依據的角色已被別人改過。 */
  USER_ROLES_CONFLICT: { status: 409 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本（別人已改過）；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  USER_VERSION_CONFLICT: { status: 409 },
  /** 還原（`POST /users/:id/restore`）一個沒有被刪除的使用者（docs/architecture/backend/14-revisions.md §9.2 D6）。 */
  USER_NOT_DELETED: { status: 409 },

  // ── 角色 ──
  ROLE_NOT_FOUND: { status: 404 },
  ROLE_NAME_DUPLICATE: { status: 409 },
  ROLE_SYSTEM_PROTECTED: { status: 403 },
  ROLE_SUPER_ADMIN_IMMUTABLE: { status: 403 },
  ROLE_IN_USE: { status: 409 },
  LAST_SUPER_ADMIN: { status: 403 },
  /** 改自己持有的角色的權限或刪除它，會讓自己失去管理角色所需的權限（docs/architecture/backend/05-rbac.md §8.4）。 */
  ROLE_SELF_LOCKOUT: { status: 403 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本（別人已改過）；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  ROLE_VERSION_CONFLICT: { status: 409 },
  /** 還原（`POST /roles/:id/restore`）一個沒有被刪除的角色（docs/architecture/backend/14-revisions.md §9 R3）。 */
  ROLE_NOT_DELETED: { status: 409 },

  // ── 群組（docs/rbac/01-domain-model.md §9.3 D11、D12） ──
  GROUP_NOT_FOUND: { status: 404 },
  GROUP_NAME_DUPLICATE: { status: 409 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本（別人已改過）；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  GROUP_VERSION_CONFLICT: { status: 409 },
  /** 還原（`POST /groups/:id/restore`）一個沒有被刪除的群組。 */
  GROUP_NOT_DELETED: { status: 409 },
  /** 把群組加進自己，或加進自己（直接或間接）的成員群組。 */
  GROUP_MEMBERSHIP_CYCLE: { status: 409 },
  /** 加入之後，群組在群組裡的鏈超過上限（`details.max`）；超過的部分解析時走不到。 */
  GROUP_NESTING_TOO_DEEP: { status: 409 },
  /** 群組不能持有 super-admin：super-admin 一律直接指派給使用者（D12）。 */
  GROUP_SUPER_ADMIN_FORBIDDEN: { status: 403 },

  // ── 服務帳號與 API token（docs/architecture/06-external-api.md §9） ──
  SERVICE_ACCOUNT_NOT_FOUND: { status: 404 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本（別人已改過）；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  SERVICE_ACCOUNT_VERSION_CONFLICT: { status: 409 },
  /** 取代角色時，送出的 `expectedRoleIds` 與目前持有的不同（別人已改過）。 */
  SERVICE_ACCOUNT_ROLES_CONFLICT: { status: 409 },
  API_TOKEN_NOT_FOUND: { status: 404 },
  /** 到期時間超過上限（`details.maxDays`）：個人 token 與服務帳號的 token 各有上限，租戶設定只能調短（D8）。 */
  API_TOKEN_LIFETIME_EXCEEDED: { status: 400 },
  /** 一個帳號未撤銷、未過期的 token 已達上限（`details.max`）。 */
  API_TOKEN_LIMIT_REACHED: { status: 409 },

  // ── Webhook（docs/architecture/backend/17-webhook.md §9） ──
  WEBHOOK_NOT_FOUND: { status: 404 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  WEBHOOK_VERSION_CONFLICT: { status: 409 },
  /**
   * 網址不能用（D15）：`details.reason` 是 `protocol`（production 只接受 https）、`credentials`（網址帶帳密）、
   * `blocked`（解析到私有、loopback 或保留位址）或 `unresolvable`（解析不到）。
   */
  WEBHOOK_URL_NOT_ALLOWED: { status: 400 },
  /** 訂閱了沒有登記的事件（`details.events`）。 */
  WEBHOOK_EVENT_UNKNOWN: { status: 400 },
  /** 停用中的訂閱不能送測試事件或重送（D17）。 */
  WEBHOOK_DISABLED: { status: 409 },
  /** 一個租戶的訂閱數已達上限（`details.max`）。 */
  WEBHOOK_LIMIT_REACHED: { status: 409 },
  /**
   * 整個租戶不重複的目標網址數會超過上限 `webhook.maxUrls`（`details.max`；docs/architecture/05-tenancy.md §13.3 D11）。
   * 只擋讓數量變多的變更。
   */
  WEBHOOK_URL_LIMIT_REACHED: { status: 409 },
  /** 要重送的投遞紀錄不存在、不屬於這個訂閱，或事件已被保留清理刪除。 */
  WEBHOOK_DELIVERY_NOT_FOUND: { status: 404 },

  // ── 標籤（docs/architecture/backend/18-tag.md §7） ──
  /** 標籤不存在；指派時也用在「不屬於這個資源的標籤組」（`details.tagIds`）。 */
  TAG_NOT_FOUND: { status: 404 },
  /** 樂觀鎖：`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  TAG_VERSION_CONFLICT: { status: 409 },
  /** 同一個標籤組已有同名的標籤（不分大小寫）。 */
  TAG_NAME_DUPLICATE: { status: 409 },
  /** 標籤組或資源類型沒有登記（或所屬 feature 沒啟用時以 `FEATURE_DISABLED` 回應）。 */
  TAG_SCOPE_NOT_FOUND: { status: 404 },
  /** 一個標籤組的標籤數、或一個資源的標籤數超過上限（`details.max`）。 */
  TAG_LIMIT_REACHED: { status: 409 },

  // ── 版本歷史（docs/architecture/backend/14-revisions.md） ──
  /** 指定的版本不存在（或已被保留清理刪除）。 */
  REVISION_NOT_FOUND: { status: 404 },
  /** 那一版的快照超過上限而未保存（`details.reason: 'tooLarge'`），無法還原（docs/architecture/backend/14-revisions.md §9.2 D1）。 */
  REVISION_UNAVAILABLE: { status: 409 },

  // ── 站內通知 ──
  /** 通知不存在，或不是自己的（不透露別人的通知是否存在；docs/architecture/backend/15-notification.md §12.2 D9）。 */
  NOTIFICATION_NOT_FOUND: { status: 404 },
  /** 事件管理：事件沒有登記、所屬 feature 沒啟用，或該事件不支援這個管道（docs/architecture/backend/16-notification-event.md §9.2 D9）。 */
  NOTIFICATION_EVENT_NOT_FOUND: { status: 404 },
  /** 事件管理：不能關的事件（安全事件，docs/architecture/backend/16-notification-event.md §9.2 D4）。 */
  NOTIFICATION_EVENT_MANDATORY: { status: 409 },
  /** 個人設定：租戶不允許調整這個事件 ＋ 管道（`details.lock`：`mandatory`／`tenantDisabled`／`tenantRequired`；docs/architecture/backend/16-notification-event.md §9.2 D14）。 */
  NOTIFICATION_PREFERENCE_LOCKED: { status: 409 },

  // ── 公告與排程通知（docs/architecture/backend/19-announcement.md §9） ──
  ANNOUNCEMENT_NOT_FOUND: { status: 404 },
  /** 樂觀鎖：送出的 `version` 不是目前的版本；`details.current` 帶目前版本（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
  ANNOUNCEMENT_VERSION_CONFLICT: { status: 409 },
  /** 目前的狀態不能這樣做（例：已完成的不能編輯、草稿不能暫停）；`details.status` 是目前的狀態。 */
  ANNOUNCEMENT_INVALID_STATE: { status: 409 },
  /** 指定的發送時間已經過去（`details.at`）：送出或恢復時檢查。 */
  ANNOUNCEMENT_TRIGGER_IN_PAST: { status: 400 },
  /** 送出時沒有選任何受眾。 */
  ANNOUNCEMENT_AUDIENCE_EMPTY: { status: 400 },
  /** 事件點不在觸發點目錄上（或所屬 feature 沒啟用）；`details.event`。 */
  ANNOUNCEMENT_EVENT_UNKNOWN: { status: 400 },
  /** 還原一則沒有被刪除的公告。 */
  ANNOUNCEMENT_NOT_DELETED: { status: 409 },
  /** 發送紀錄不存在，或不屬於這則公告。 */
  ANNOUNCEMENT_DISPATCH_NOT_FOUND: { status: 404 },
  /** 只有還沒撤回的發送能撤回；`details.status` 是目前的狀態。 */
  ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE: { status: 409 },
  /** 收件人讀全文：沒有收到這次發送（或已被撤回、已被保留清理刪除）。 */
  ANNOUNCEMENT_MESSAGE_NOT_FOUND: { status: 404 },

  // ── 權限 ──
  PERMISSION_UNKNOWN: { status: 400 },

  // ── 審批 ──
  APPROVAL_NOT_FOUND: { status: 404 },
  APPROVAL_ALREADY_REVIEWED: { status: 409 },
  APPROVAL_SELF_REVIEW: { status: 403 },

  // ── 外部 IdP 連線 ──
  IDENTITY_PROVIDER_NOT_FOUND: { status: 404 },
  IDENTITY_PROVIDER_NAME_DUPLICATE: { status: 409 },
  /** 網域已經屬於另一個連線（一個網域只屬於一個連線）。 */
  IDENTITY_PROVIDER_DOMAIN_TAKEN: { status: 409 },
  /** 連線數已達租戶的上限 `identityProvider.maxProviders`（`details.max`；docs/architecture/05-tenancy.md §13.3 D10）。 */
  IDENTITY_PROVIDER_LIMIT_REACHED: { status: 409 },

  // ── 稽核日誌 ──
  AUDIT_LOG_NOT_FOUND: { status: 404 },

  // ── 背景工作 ──
  JOB_NOT_FOUND: { status: 404 },
  JOB_NOT_RETRYABLE: { status: 409 },

  // ── 檔案 ──
  FILE_NOT_FOUND: { status: 404 },
  FILE_TOO_LARGE: { status: 413 },
  /**
   * 這次上傳會讓檔案大小合計超過租戶的容量 `file.storageQuotaMb`（docs/architecture/05-tenancy.md §13.3 D8）；
   * `details`：`quota`、`used`、`size`（位元組）。
   */
  FILE_STORAGE_QUOTA_EXCEEDED: { status: 409 },
  FILE_ALREADY_UPLOADED: { status: 409 },
  FILE_UPLOAD_INCOMPLETE: { status: 409 },
  FILE_SIZE_MISMATCH: { status: 422 },
  FILE_STORAGE_UNAVAILABLE: { status: 503 },
  FILE_UPLOAD_PART_INVALID: { status: 422 },
  FILE_VERSION_CONFLICT: { status: 409 },
  FILE_IMAGE_URL_INVALID: { status: 403 },
  /** 影像 API 明確指定的格式轉出來超過上限（大圖的原圖轉成 PNG）；`details.maxSize`（位元組）。 */
  FILE_IMAGE_TOO_LARGE: { status: 422 },
  FILE_FOLDER_NOT_FOUND: { status: 404 },
  FILE_FOLDER_NAME_CONFLICT: { status: 409 },
  FILE_FOLDER_CYCLE: { status: 422 },
  FILE_FOLDER_SYSTEM_PROTECTED: { status: 403 },
  FILE_GRANT_SUBJECT_NOT_FOUND: { status: 404 },
  FILE_GRANT_NOT_FOUND: { status: 404 },
  FILE_ACCESS_ALREADY_GRANTED: { status: 409 },
  FILE_ACCESS_REQUEST_NOT_FOUND: { status: 404 },
  /** 還原（`POST /files/:id/restore`）一個沒有被刪除的檔案（docs/architecture/backend/14-revisions.md §9 R4）。 */
  FILE_NOT_DELETED: { status: 409 },
  /** 還原的檔案所在的資料夾已刪除（`details.reason = 'parentDeleted'`）或物件已不在（`'objectMissing'`）。 */
  FILE_RESTORE_CONFLICT: { status: 409 },
  /** 還原（`POST /file-folders/:id/restore`）一個沒有被刪除的資料夾。 */
  FILE_FOLDER_NOT_DELETED: { status: 409 },
  /** 還原的資料夾的上層已刪除（`details.reason = 'parentDeleted'`）。 */
  FILE_FOLDER_RESTORE_CONFLICT: { status: 409 },

  // ── 系統設定 ──
  /** 沒有登記這個 key 的設定（docs/architecture/backend/12-settings.md）。 */
  SETTING_NOT_FOUND: { status: 404 },

  // ── 通用 ──
  /** 路徑不存在（框架層的 404；業務上找不到資源用各自的 `<DOMAIN>_NOT_FOUND`）。 */
  NOT_FOUND: { status: 404 },
  /** 沒有對應到業務錯誤碼的唯一鍵衝突：多半是併發的重複寫入，重試或重新整理即可。 */
  CONFLICT: { status: 409 },
  RATE_LIMITED: { status: 429 },
  INTERNAL_ERROR: { status: 500 },
} as const;

export type ErrorCode = keyof typeof ErrorCode;

export const ALL_ERROR_CODES = Object.keys(ErrorCode) as ErrorCode[];

export function statusOf(code: ErrorCode): number {
  return ErrorCode[code].status;
}
