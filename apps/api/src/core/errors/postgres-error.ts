/** Postgres 唯一鍵衝突（23505）：service 的預檢查與 INSERT 之間有競態。 */
const UNIQUE_VIOLATION = '23505';

interface PostgresError {
  code?: string;
  constraint_name?: string;
  message?: string;
}

/** Drizzle 會把驅動的錯誤包一層（`Failed query: …`），真正的錯誤在 `cause`。 */
function asPostgresError(error: unknown): PostgresError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as PostgresError & { cause?: unknown };
  if (candidate.code === undefined && candidate.cause) return asPostgresError(candidate.cause);
  return candidate;
}

export function isUniqueViolation(error: unknown): boolean {
  return asPostgresError(error)?.code === UNIQUE_VIOLATION;
}

export function constraintNameOf(error: unknown): string | undefined {
  return asPostgresError(error)?.constraint_name;
}

/** plpgsql 的 `RAISE EXCEPTION 'CODE: message'`（trigger 第二道防線）。 */
export function raisedErrorCode(error: unknown): string | undefined {
  const message = asPostgresError(error)?.message;
  const matched = message?.match(/^([A-Z_]+):/);
  return matched?.[1];
}

const CONSTRAINT_TO_CODE: Record<string, string> = {
  users_email_key: 'USER_EMAIL_DUPLICATE',
  users_username_key: 'USER_USERNAME_DUPLICATE',
  roles_name_key: 'ROLE_NAME_DUPLICATE',
  roles_slug_key: 'ROLE_NAME_DUPLICATE',
};

/**
 * 唯一鍵衝突 → 錯誤碼。沒有登記的約束回通用的 `CONFLICT`（409）而不是 500：
 * 衝突是請求與現有資料的問題，不是伺服器壞了（docs/issues/03-edge-cases.md EDGE-17）。
 */
export function mapConstraintToCode(constraint: string | undefined): string {
  return (constraint && CONSTRAINT_TO_CODE[constraint]) ?? 'CONFLICT';
}
