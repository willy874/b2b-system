/**
 * 錯誤碼是前後端的穩定契約：前端用 `t('error.' + code)` 顯示訊息。
 * 新增一個碼時，必須同步加上 `apps/backstage/src/app/locales/{en_US,zh_TW}.json`
 * 的 `error.<CODE>`（有測試比對）。
 */
export const ErrorCode = {
  // ── 驗證 ──
  VALIDATION_FAILED: { status: 400 },

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
  /** 登入互動不存在、已過期，或瀏覽器沒有帶互動 cookie（docs/adr/0019-sso-identity-platform.md）。 */
  AUTH_SSO_INTERACTION_INVALID: { status: 400 },
  /** 授權碼無效：不存在、已用過、過期、client 或 redirect URI 不符、PKCE 不符（不細分，不洩漏哪一項）。 */
  AUTH_SSO_CODE_INVALID: { status: 400 },

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
  /** 角色的範圍與權限鍵或指派的地方不符（docs/adr/0018-workspace-tenancy.md D3）。 */
  ROLE_SCOPE_MISMATCH: { status: 422 },

  // ── 權限 ──
  PERMISSION_UNKNOWN: { status: 400 },

  // ── 審批 ──
  APPROVAL_NOT_FOUND: { status: 404 },
  APPROVAL_ALREADY_REVIEWED: { status: 409 },
  APPROVAL_SELF_REVIEW: { status: 403 },

  // ── 工作區 ──
  /** 不存在、已刪除，或操作者不是成員（不洩漏工作區是否存在，D9）。 */
  WORKSPACE_NOT_FOUND: { status: 404 },
  WORKSPACE_SLUG_DUPLICATE: { status: 409 },
  WORKSPACE_MEMBER_NOT_FOUND: { status: 404 },
  WORKSPACE_MEMBER_DUPLICATE: { status: 409 },
  /** 移除最後一位能管理成員的人（D12）。 */
  WORKSPACE_LAST_ADMIN: { status: 409 },
  /** 邀請不存在，或已經接受／撤銷（撤銷時）。 */
  WORKSPACE_INVITATION_NOT_FOUND: { status: 404 },
  /** 同一個 email 同時被邀請兩次（待接受的唯一索引）。 */
  WORKSPACE_INVITATION_DUPLICATE: { status: 409 },
  /** 邀請連結無效：token 不對、已過期、已接受或已撤銷，或工作區已刪除。 */
  WORKSPACE_INVITATION_INVALID: { status: 400 },
  /** 登入的帳號與受邀的 email 不同。 */
  WORKSPACE_INVITATION_EMAIL_MISMATCH: { status: 403 },
  /** 受邀的 email 已經有帳號：要登入後接受，不能再建立帳號。 */
  WORKSPACE_INVITATION_ACCOUNT_EXISTS: { status: 409 },
  /** 邀請還沒有帳號的 email，邀請人另外需要平台的 `user:create`（D14）。 */
  WORKSPACE_INVITATION_USER_CREATE_REQUIRED: { status: 403 },

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

  // ── 通用 ──
  RATE_LIMITED: { status: 429 },
  INTERNAL_ERROR: { status: 500 },
} as const;

export type ErrorCode = keyof typeof ErrorCode;

export const ALL_ERROR_CODES = Object.keys(ErrorCode) as ErrorCode[];

export function statusOf(code: ErrorCode): number {
  return ErrorCode[code].status;
}
