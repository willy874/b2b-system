/**
 * 錯誤碼是前後端的穩定契約：前端用 `t('error.' + code)` 顯示訊息。
 * 新增一個碼時，必須同步加上 `apps/backstage/src/app/locales/{en_US,zh_TW}.json`
 * 的 `error.<CODE>`（有測試比對）。
 */
export const ErrorCode = {
  // ── 驗證 ──
  VALIDATION_FAILED: { status: 400 },

  // ── 租戶（docs/adr/0020-physical-tenant-isolation.md D2） ──
  /** 請求的網域不屬於任何租戶（或程式在沒有租戶脈絡的地方存取租戶 DB）。 */
  TENANT_NOT_FOUND: { status: 404 },
  /** 租戶停用、佈建中或佈建失敗。 */
  TENANT_UNAVAILABLE: { status: 503 },
  /** 平台管理者的端點只在 apps/auth 的網域（不屬於任何租戶）提供；租戶網域上等同不存在。 */
  PLATFORM_ONLY: { status: 404 },
  /** 建立租戶：代碼已被使用（未刪除的租戶；D12）。 */
  TENANT_CODE_TAKEN: { status: 409 },
  /** 網域已屬於另一個租戶（一個網域只屬於一個租戶，D2）。 */
  TENANT_DOMAIN_TAKEN: { status: 409 },
  /** 租戶目前的狀態不能做這個動作（例：啟用一個佈建中的租戶、重試一個沒有失敗的佈建）。 */
  TENANT_STATUS_CONFLICT: { status: 409 },
  /** 不能移除租戶的最後一個網域（沒有網域就沒有入口）。 */
  TENANT_LAST_DOMAIN: { status: 409 },
  /** 平台管理者不存在（或已刪除）。 */
  PLATFORM_ADMIN_NOT_FOUND: { status: 404 },
  /** 租戶不允許設定外部 IdP 連線（平台管理者關掉了，D22）。 */
  IDENTITY_PROVIDER_NOT_ALLOWED: { status: 403 },

  // ── 認證 ──
  AUTH_INVALID_CREDENTIALS: { status: 401 },
  AUTH_ACCOUNT_PENDING: { status: 401 },
  AUTH_ACCOUNT_DISABLED: { status: 403 },
  AUTH_ACCOUNT_LOCKED: { status: 403 },
  AUTH_TOKEN_INVALID: { status: 401 },
  AUTH_TOKEN_STALE: { status: 401 },
  AUTH_REFRESH_INVALID: { status: 401 },
  AUTH_REFRESH_EXPIRED: { status: 401 },
  AUTH_REFRESH_REVOKED: { status: 401 },
  AUTH_REFRESH_REUSED: { status: 401 },
  AUTH_PASSWORD_MISMATCH: { status: 400 },
  AUTH_PASSWORD_WEAK: { status: 400 },
  AUTH_SETUP_TOKEN_INVALID: { status: 400 },
  /** 租戶關閉了註冊申請（設定 `auth.registrationEnabled`）：端點等同不存在。 */
  AUTH_REGISTRATION_DISABLED: { status: 404 },
  /** 登入互動不存在、已過期，或瀏覽器沒有帶互動 cookie（docs/adr/0019-sso-identity-platform.md）。 */
  AUTH_SSO_INTERACTION_INVALID: { status: 400 },
  /** 授權碼無效：不存在、已用過、過期、client 或 redirect URI 不符、PKCE 不符（不細分，不洩漏哪一項）。 */
  AUTH_SSO_CODE_INVALID: { status: 400 },
  /** 這個 email 網域只允許 SSO：不能用密碼登入（docs/adr/0019-sso-identity-platform.md D9）。 */
  AUTH_SSO_REQUIRED: { status: 403 },
  /** 外部 IdP 登入成功，但沒有對應的帳號，而連線設定為拒絕（D10）。 */
  AUTH_SSO_ACCOUNT_NOT_FOUND: { status: 403 },
  /** 外部 IdP 連線不存在、已停用，或無法連線（discovery 失敗）。 */
  AUTH_SSO_PROVIDER_UNAVAILABLE: { status: 400 },
  /** 外部 IdP 回來的結果無效：state 不對、已過期、授權碼兌換失敗、ID token 驗證失敗。 */
  AUTH_SSO_EXTERNAL_FAILED: { status: 400 },

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

  // ── 角色 ──
  ROLE_NOT_FOUND: { status: 404 },
  ROLE_NAME_DUPLICATE: { status: 409 },
  ROLE_SYSTEM_PROTECTED: { status: 403 },
  ROLE_SUPER_ADMIN_IMMUTABLE: { status: 403 },
  ROLE_IN_USE: { status: 409 },
  LAST_SUPER_ADMIN: { status: 403 },

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

  // ── 背景工作 ──
  JOB_NOT_FOUND: { status: 404 },
  JOB_NOT_RETRYABLE: { status: 409 },

  // ── 檔案 ──
  FILE_NOT_FOUND: { status: 404 },
  FILE_TOO_LARGE: { status: 413 },
  FILE_ALREADY_UPLOADED: { status: 409 },
  FILE_UPLOAD_INCOMPLETE: { status: 409 },
  FILE_SIZE_MISMATCH: { status: 422 },
  FILE_STORAGE_UNAVAILABLE: { status: 503 },
  FILE_UPLOAD_PART_INVALID: { status: 422 },
  FILE_VERSION_CONFLICT: { status: 409 },
  FILE_IMAGE_URL_INVALID: { status: 403 },
  FILE_FOLDER_NOT_FOUND: { status: 404 },
  FILE_FOLDER_NAME_CONFLICT: { status: 409 },
  FILE_FOLDER_CYCLE: { status: 422 },
  FILE_FOLDER_SYSTEM_PROTECTED: { status: 403 },
  FILE_GRANT_SUBJECT_NOT_FOUND: { status: 404 },
  FILE_GRANT_NOT_FOUND: { status: 404 },
  FILE_ACCESS_ALREADY_GRANTED: { status: 409 },
  FILE_ACCESS_REQUEST_NOT_FOUND: { status: 404 },

  // ── 系統設定 ──
  /** 沒有登記這個 key 的設定（docs/architecture/backend/12-settings.md）。 */
  SETTING_NOT_FOUND: { status: 404 },

  // ── 通用 ──
  RATE_LIMITED: { status: 429 },
  INTERNAL_ERROR: { status: 500 },
} as const;

export type ErrorCode = keyof typeof ErrorCode;

export const ALL_ERROR_CODES = Object.keys(ErrorCode) as ErrorCode[];

export function statusOf(code: ErrorCode): number {
  return ErrorCode[code].status;
}
