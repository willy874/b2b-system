export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'AppError';
  }

  /** `429` 時伺服器建議的等待秒數（`details.retryAfterSeconds`，或 `Retry-After` 標頭）。 */
  get retryAfterSeconds(): number | undefined {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.ceil(value)
      : undefined;
  }

  /** 欄位層級錯誤（表單回填用）。 */
  get fieldErrors(): Record<string, string> | undefined {
    const fields = this.details?.fields;
    return fields && typeof fields === 'object' ? (fields as Record<string, string>) : undefined;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** 資源不存在（404）：重試沒有意義，改提供返回等後續動作。 */
export function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.status === 404;
}

export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_STALE: 'AUTH_TOKEN_STALE',
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  AUTH_REFRESH_EXPIRED: 'AUTH_REFRESH_EXPIRED',
  AUTH_REFRESH_REVOKED: 'AUTH_REFRESH_REVOKED',
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',
  AUTHZ_FORBIDDEN: 'AUTHZ_FORBIDDEN',
  AUTHZ_ESCALATION: 'AUTHZ_ESCALATION',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/** 收到這些碼代表 session 已被終止：不要嘗試續期，直接登出。 */
export const SESSION_TERMINAL_CODES = new Set<string>([
  // 帳號被停用／刪除：後端在驗 token_version 之前就先擋下，對前端一樣是「session 結束」
  ErrorCodes.AUTH_ACCOUNT_DISABLED,
  ErrorCodes.AUTH_TOKEN_STALE,
  ErrorCodes.AUTH_REFRESH_INVALID,
  ErrorCodes.AUTH_REFRESH_EXPIRED,
  ErrorCodes.AUTH_REFRESH_REVOKED,
  ErrorCodes.AUTH_REFRESH_REUSED,
]);

/**
 * 伺服器明確拒絕了這個 session（401 或終止類錯誤碼）。
 * 網路錯誤、5xx、429、逾時都 **不是**：那是暫時性失敗，結束 session 只會把使用者無故登出。
 */
export function isSessionRejected(error: unknown): boolean {
  return (
    error instanceof AppError && (error.status === 401 || SESSION_TERMINAL_CODES.has(error.code))
  );
}
